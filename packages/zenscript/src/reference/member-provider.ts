import type { AstNode, Stream } from 'langium'
import type { ZenScriptServices } from '../module'
import type { TypeComputer } from '../typing/type-computer'
import type { Type, ZenScriptType } from '../typing/type-description'
import type { ZenScriptSyntheticAstType } from './synthetic'
import { EMPTY_STREAM, stream } from 'langium'
import * as ast from '../generated/ast'
import { applySubstIfPresent, ClassType } from '../typing/type-description'
import { isStatic, streamClassChain } from '../utils/ast'
import { isNamespaceNode } from '../utils/namespace-tree'
import { defineRules } from '../utils/rule'
import { createSyntheticAstNode } from './synthetic'

export interface MemberProvider {
  streamMembers: (element: AstNode | Type | undefined) => Stream<AstNode>
  getLambda: (element: AstNode | Type | undefined) => ast.FunctionDeclaration | undefined
  getOperator: (element: AstNode | Type | undefined, operator: string, length: number) => ast.OperatorFunctionDeclaration | undefined
}

type RuleSpec = ast.ZenScriptAstType & ZenScriptType & ZenScriptSyntheticAstType
type RuleMap = { [K in keyof RuleSpec]?: (element: RuleSpec[K]) => Stream<AstNode> | undefined }

export class ZenScriptMemberProvider implements MemberProvider {
  private readonly typeComputer: TypeComputer

  constructor(services: ZenScriptServices) {
    this.typeComputer = services.typing.TypeComputer
  }

  streamMembers(element: AstNode | Type | undefined): Stream<AstNode> {
    return this.memberRules(element?.$type)?.call(this, element) ?? EMPTY_STREAM
  }

  getLambda(element: AstNode | Type | undefined) {
    return this.streamMembers(element)
      .filter(ast.isFunctionDeclaration)
      .filter(it => it.variance === 'lambda')
      .head()
  }

  getOperator(type: AstNode | Type | undefined, operator: string, length: number) {
    return this.streamMembers(type)
      .filter(ast.isOperatorFunctionDeclaration)
      .filter(it => it.operator === operator)
      .filter(it => it.params.length === length)
      .head()
  }

  private streamTypeMembers(element: AstNode): Stream<AstNode> {
    const type = this.typeComputer.inferType(element)
    return this.streamMembers(type)
  }

  private readonly memberRules = defineRules<RuleMap>({
    SyntheticAstNode: ({ content }) => {
      if (isNamespaceNode(content)) {
        return stream(content.children.values())
          .flatMap(it => it.hasData() ? it.data : createSyntheticAstNode(it))
      }
    },

    NamedTypeItem: (element) => {
      return this.streamMembers(element.entity.ref)
    },

    Script: (element) => {
      return stream<AstNode>(
        element.classes,
        element.functions,
        element.statements.filter(ast.isVariableDeclaration).filter(isStatic),
      )
    },

    ImportDeclaration: (element) => {
      return this.streamMembers(element.item?.entity?.ref)
    },

    ImportItem: (element) => {
      return this.streamMembers(element.entity?.ref)
    },

    ClassDeclaration: (element) => {
      return stream(element.members).filter(isStatic)
    },

    VariableDeclaration: element => this.streamTypeMembers(element),

    LoopParameter: element => this.streamTypeMembers(element),

    ValueParameter: element => this.streamTypeMembers(element),

    ParenthesizedExpression: element => this.streamTypeMembers(element),

    PrefixExpression: element => this.streamTypeMembers(element),

    InfixExpression: element => this.streamTypeMembers(element),

    IndexExpression: element => this.streamTypeMembers(element),

    CallExpression: element => this.streamTypeMembers(element),

    BracketExpression: element => this.streamTypeMembers(element),

    FieldDeclaration: element => this.streamTypeMembers(element),

    StringLiteral: element => this.streamTypeMembers(element),

    StringTemplate: element => this.streamTypeMembers(element),

    IntegerLiteral: element => this.streamTypeMembers(element),

    FloatLiteral: element => this.streamTypeMembers(element),

    BooleanLiteral: element => this.streamTypeMembers(element),

    AccessExpression: (element) => {
      if (element.withArgs) {
        return this.streamTypeMembers(element)
      }

      const entity = element.entity?.ref
      if (!entity) {
        return
      }

      const receiverType = this.typeComputer.inferType(element.receiver)
      if (!receiverType) {
        return this.streamMembers(entity)
      }

      const elementType = this.typeComputer.inferType(element)
      const substituted = applySubstIfPresent(receiverType, elementType)
      return this.streamMembers(substituted)
    },

    ReferenceExpression: (element) => {
      const entity = element.entity?.ref
      const name = element.entity.$refText
      if (name === 'this' && ast.isClassDeclaration(entity)) {
        return this.streamMembers(new ClassType(entity.name, entity))
      }
      else {
        return this.streamMembers(entity)
      }
    },

    ClassType: (element) => {
      return streamClassChain(element.decl)
        .flatMap(it => it.members)
        .filter(it => !isStatic(it))
    },
  })
}
