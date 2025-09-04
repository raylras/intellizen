import type { AstNode, Stream } from 'langium'
import type { ZenScriptServices } from '../module'
import type { TypeComputer } from '../typing/type-computer'
import type { Type, ZenScriptType } from '../typing/type-description'
import type { ZenScriptSyntheticAstType } from './synthetic'
import { AstUtils, EMPTY_STREAM, stream } from 'langium'
import * as ast from '../generated/ast'
import { applySubstIfPresent, ClassType, isAnyType, isFunctionType } from '../typing/type-description'
import { isStatic, streamClassChain } from '../utils/ast'
import { isNamespaceNode } from '../utils/namespace-tree'
import { defineRules } from '../utils/rule'
import { createSyntheticAstNode, isSyntheticAstNode } from './synthetic'

export interface MemberProvider {
  streamMembers: (element: AstNode | Type | undefined) => Stream<AstNode>
}

type RuleSpec = ast.ZenScriptAstType & ZenScriptType & ZenScriptSyntheticAstType
type RuleMap = { [K in keyof RuleSpec]?: (element: RuleSpec[K]) => Stream<AstNode> | undefined }

export class ZenScriptMemberProvider implements MemberProvider {
  private readonly typeComputer: TypeComputer

  constructor(services: ZenScriptServices) {
    this.typeComputer = services.typing.TypeComputer
  }

  public streamMembers(element: AstNode | Type | undefined): Stream<AstNode> {
    return this.memberRules(element?.$type)?.call(this, element) ?? EMPTY_STREAM
  }

  private readonly memberRules = defineRules<RuleMap>({
    SyntheticAstNode: (element) => {
      if (isNamespaceNode(element.content)) {
        return stream(element.content.children.values()).flatMap(it => it.hasData() ? it.data : createSyntheticAstNode(it))
      }
    },

    Script: (element) => {
      return stream<AstNode>(
        element.classes,
        element.functions,
        element.statements.filter(ast.isVariableDeclaration).filter(isStatic),
      )
    },

    ImportDeclaration: (element) => {
      const entity = element.path.at(-1)?.ref
      if (entity) {
        return stream([entity])
      }
    },

    ClassDeclaration: (element) => {
      return stream(element.members).filter(isStatic)
    },

    VariableDeclaration: (element) => {
      const type = this.typeComputer.inferType(element)
      return this.streamMembers(type)
    },

    LoopParameter: (element) => {
      const type = this.typeComputer.inferType(element)
      return this.streamMembers(type)
    },

    ValueParameter: (element) => {
      const type = this.typeComputer.inferType(element)
      return this.streamMembers(type)
    },

    AccessExpression: (element) => {
      const entity = element.entity.ref
      if (!entity) {
        return EMPTY_STREAM
      }

      if (isSyntheticAstNode(entity) || ast.isScript(entity) || ast.isClassDeclaration(entity)) {
        return this.streamMembers(entity)
      }

      const receiverType = this.typeComputer.inferType(element.receiver)
      if (!receiverType) {
        // may be static declaration
        return this.streamMembers(entity)
      }

      const elementType = this.typeComputer.inferType(element)
      return this.streamMembers(applySubstIfPresent(receiverType, elementType))
    },

    ParenthesizedExpression: (element) => {
      const type = this.typeComputer.inferType(element)
      return this.streamMembers(type)
    },

    PrefixExpression: (element) => {
      const type = this.typeComputer.inferType(element)
      return this.streamMembers(type)
    },

    InfixExpression: (element) => {
      const type = this.typeComputer.inferType(element)
      return this.streamMembers(type)
    },

    IndexExpression: (element) => {
      const type = this.typeComputer.inferType(element)
      return this.streamMembers(type)
    },

    ReferenceExpression: (element) => {
      if (element.entity.$refText === 'this' && ast.isClassDeclaration(element.entity.ref)) {
        return this.streamMembers(new ClassType(element.entity.$refText, element.entity.ref))
      }
      return this.streamMembers(element.entity.ref)
    },

    CallExpression: (element) => {
      if (ast.isReferenceExpression(element.receiver) || ast.isAccessExpression(element.receiver)) {
        const entity = element.receiver.entity.ref
        if (ast.isConstructorDeclaration(entity)) {
          const classDecl = AstUtils.getContainerOfType(entity, ast.isClassDeclaration)
          if (!classDecl)
            return EMPTY_STREAM
          return this.streamMembers(new ClassType(classDecl.name, classDecl))
        }

        if (ast.isFunctionDeclaration(entity)) {
          const retType = this.typeComputer.inferType(entity.retType)
          return this.streamMembers(retType)
        }
      }

      const receiverType = this.typeComputer.inferType(element.receiver)
      if (isFunctionType(receiverType)) {
        return this.streamMembers(receiverType.ret)
      }
      if (isAnyType(receiverType)) {
        return this.streamMembers(receiverType)
      }
      return EMPTY_STREAM
    },

    BracketExpression: (element) => {
      const type = this.typeComputer.inferType(element)
      return this.streamMembers(type)
    },

    FieldDeclaration: (element) => {
      const type = this.typeComputer.inferType(element)
      return this.streamMembers(type)
    },

    StringLiteral: (element) => {
      const type = this.typeComputer.inferType(element)
      return this.streamMembers(type)
    },

    StringTemplate: (element) => {
      const type = this.typeComputer.inferType(element)
      return this.streamMembers(type)
    },

    IntegerLiteral: (element) => {
      const type = this.typeComputer.inferType(element)
      return this.streamMembers(type)
    },

    FloatLiteral: (element) => {
      const type = this.typeComputer.inferType(element)
      return this.streamMembers(type)
    },

    BooleanLiteral: (element) => {
      const type = this.typeComputer.inferType(element)
      return this.streamMembers(type)
    },

    ClassType: (element) => {
      if (!element.decl) {
        return EMPTY_STREAM
      }
      return streamClassChain(element.decl)
        .flatMap(it => it.members)
        .filter(it => !isStatic(it))
    },
  })
}
