import type { AstNode, IndexManager, Stream } from 'langium'
import type { ZenScriptServices } from '../module'
import type { TypeComputer } from '../typing/type-computer'
import type { Type, ZenScriptType } from '../typing/type-description'
import type { TypeFeatures } from '../typing/type-features'
import type { ZenScriptSyntheticAstType } from './synthetic'
import { EMPTY_STREAM, stream } from 'langium'
import * as ast from '../generated/ast'
import { applySubstIfPresent, ClassType } from '../typing/type-description'
import { isStatic, streamClassChain } from '../utils/ast'
import { isNamespaceNode } from '../utils/namespace-tree'
import { defineRules } from '../utils/rule'
import { createSyntheticAstNode } from './synthetic'

export interface MemberProvider {
  getMembers: (element: AstNode | Type | undefined) => Stream<AstNode>
  getLambda: (element: AstNode | Type | undefined) => ast.FunctionDeclaration | undefined
  getOperator: (element: AstNode | Type | undefined, operator: string, length: number) => ast.OperatorFunctionDeclaration | undefined
}

type RuleSpec = ast.ZenScriptAstType & ZenScriptType & ZenScriptSyntheticAstType
type RuleMap = { [K in keyof RuleSpec]?: (element: RuleSpec[K]) => Stream<AstNode> | undefined }

export class ZenScriptMemberProvider implements MemberProvider {
  private readonly typeComputer: () => TypeComputer
  private readonly typeFeatures: () => TypeFeatures
  private readonly indexManager: IndexManager

  constructor(services: ZenScriptServices) {
    this.typeComputer = () => services.typing.TypeComputer
    this.typeFeatures = () => services.typing.TypeFeatures
    this.indexManager = services.shared.workspace.IndexManager
  }

  getMembers(element: AstNode | Type | undefined): Stream<AstNode> {
    return this.memberRules(element?.$type)?.call(this, element) ?? EMPTY_STREAM
  }

  getLambda(element: AstNode | Type | undefined) {
    return this.getMembers(element)
      .filter(ast.isFunctionDeclaration)
      .filter(it => it.variance === 'lambda')
      .head()
  }

  getOperator(type: AstNode | Type | undefined, operator: string, length: number) {
    return this.getMembers(type)
      .filter(ast.isOperatorFunctionDeclaration)
      .filter(it => it.operator === operator)
      .filter(it => it.params.length === length)
      .head()
  }

  private getTypeMembers(element: AstNode): Stream<AstNode> {
    const type = this.typeComputer().inferType(element)
    return this.getMembers(type).concat(this.getExpandMembers(type))
  }

  private getExpandMembers(element: Type | undefined): Stream<ast.ExpandMemberDeclaration | ast.ExpandFunctionDeclaration> {
    if (!element)
      return EMPTY_STREAM

    return this.indexManager.allElements().flatMap((symbol) => {
      if (ast.isExpandDeclaration(symbol.node)) {
        const type = this.typeComputer().inferType(symbol.node.type)
        if (this.typeFeatures().isSubType(element, type)) {
          return symbol.node.members
        }
      }
      else if (ast.isExpandFunctionDeclaration(symbol.node)) {
        const type = this.typeComputer().inferType(symbol.node.type)
        if (this.typeFeatures().isSubType(element, type)) {
          return symbol.node
        }
      }
      return EMPTY_STREAM
    })
  }

  private readonly memberRules = defineRules<RuleMap>({
    SyntheticAstNode: ({ content }) => {
      if (isNamespaceNode(content)) {
        return stream(content.children.values())
          .flatMap(it => it.hasData() ? it.data : createSyntheticAstNode(it))
      }
    },

    NamedTypeItem: (element) => {
      return this.getMembers(element.entity.ref)
    },

    Script: (element) => {
      return stream<AstNode>(
        element.classes,
        element.functions,
        element.statements.filter(ast.isVariableDeclaration).filter(isStatic),
      )
    },

    ImportDeclaration: (element) => {
      return this.getMembers(element.item?.entity?.ref)
    },

    ImportItem: (element) => {
      return this.getMembers(element.entity?.ref)
    },

    ClassDeclaration: (element) => {
      return stream(element.members).filter(isStatic)
    },

    VariableDeclaration: element => this.getTypeMembers(element),

    LoopParameter: element => this.getTypeMembers(element),

    ValueParameter: element => this.getTypeMembers(element),

    ParenthesizedExpression: element => this.getTypeMembers(element),

    PrefixExpression: element => this.getTypeMembers(element),

    InfixExpression: element => this.getTypeMembers(element),

    IndexExpression: element => this.getTypeMembers(element),

    CallExpression: element => this.getTypeMembers(element),

    BracketExpression: element => this.getTypeMembers(element),

    FieldDeclaration: element => this.getTypeMembers(element),

    StringLiteral: element => this.getTypeMembers(element),

    StringTemplate: element => this.getTypeMembers(element),

    IntegerLiteral: element => this.getTypeMembers(element),

    FloatLiteral: element => this.getTypeMembers(element),

    BooleanLiteral: element => this.getTypeMembers(element),

    AccessExpression: (element) => {
      if (element.withArgs) {
        return this.getTypeMembers(element)
      }

      const entity = element.entity?.ref
      if (!entity) {
        return
      }

      const receiverType = this.typeComputer().inferType(element.receiver)
      if (!receiverType) {
        return this.getMembers(entity)
      }

      const elementType = this.typeComputer().inferType(element)
      const substituted = applySubstIfPresent(receiverType, elementType)
      return this.getMembers(substituted)
    },

    ReferenceExpression: (element) => {
      const entity = element.entity?.ref
      const name = element.entity.$refText
      if (name === 'this') {
        return this.getTypeMembers(element)
      }
      else {
        return this.getMembers(entity)
      }
    },

    ClassType: (element) => {
      return streamClassChain(element.decl)
        .flatMap(it => it.members)
        .filter(it => !isStatic(it))
    },
  })
}
