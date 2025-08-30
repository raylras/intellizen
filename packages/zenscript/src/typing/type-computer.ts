import type { AstNode } from 'langium'
import type { ZenScriptServices } from '../module'
import type { MemberProvider } from '../reference/member-provider'
import type { ZenScriptSyntheticAstType } from '../reference/synthetic'
import type { BracketManager } from '../workspace/bracket-manager'
import type { PackageManager } from '../workspace/package-manager'
import type { BuiltinTypes, Subst, Type } from './type-description'
import { AstUtils } from 'langium'
import * as ast from '../generated/ast'
import { defineRules } from '../utils/rule'
import { ClassType, CompoundType, FunctionType, IntersectionType, isAnyType, isClassType, isFunctionType, TypeVariable } from './type-description'

type RuleSpec = ast.ZenScriptAstType & ZenScriptSyntheticAstType
type RuleMap = { [K in keyof RuleSpec]?: (element: RuleSpec[K]) => Type | undefined }

interface Context {

}

export interface TypeComputer {
  inferType: (node: AstNode | undefined, ctx?: Context) => Type | undefined
}

export class ZenScriptTypeComputer implements TypeComputer {
  private readonly bracketManager: BracketManager
  private readonly packageManager: () => PackageManager
  private readonly memberProvider: () => MemberProvider

  constructor(services: ZenScriptServices) {
    this.bracketManager = services.shared.workspace.BracketManager
    this.packageManager = () => services.references.PackageManager
    this.memberProvider = () => services.references.MemberProvider
  }

  public inferType(node: AstNode | undefined): Type | undefined {
    return this.inferRules(node?.$type)?.call(this, node)
  }

  private classTypeOf(className: BuiltinTypes | string, subst?: Subst): ClassType {
    const decl = this.classDeclOf(className)
    if (!decl) {
      console.error(new Error(`Class "${className}" is not defined.`))
    }
    return new ClassType(className, decl, subst)
  }

  private classDeclOf(className: BuiltinTypes | string): ast.ClassDeclaration | undefined {
    return this.packageManager().find(className).values().find(ast.isClassDeclaration)
  }

  private readonly inferRules = defineRules<RuleMap>({
    ArrayType: (element) => {
      const type = this.classTypeOf('Array')
      type.updateSubst(() => type.decl?.typeParams.find(it => it.name === 'T'), () => this.inferType(element.value))
      return type
    },

    ListType: (element) => {
      const type = this.classTypeOf('List')
      type.updateSubst(() => type.decl?.typeParams.find(it => it.name === 'T'), () => this.inferType(element.value))
      return type
    },

    MapType: (element) => {
      const type = this.classTypeOf('Map')
      type.updateSubst(() => type.decl?.typeParams.find(it => it.name === 'K'), () => this.inferType(element.key))
      type.updateSubst(() => type.decl?.typeParams.find(it => it.name === 'V'), () => this.inferType(element.value))
      return type
    },

    CompoundType: (element) => {
      const types = element.values.map(it => this.inferType(it) ?? this.classTypeOf('ERROR'))
      return new CompoundType(types)
    },

    ParenthesizedType: (element) => {
      return this.inferType(element.value)
    },

    FunctionType: (element) => {
      const params = element.params.map(it => this.inferType(it) ?? this.classTypeOf('any'))
      const ret = this.inferType(element.retType) ?? this.classTypeOf('any')
      return new FunctionType(params, ret)
    },

    NamedType: (element) => {
      const last = element.path.at(-1)?.ref
      let type: Type | undefined
      if (ast.isTypeParameter(last)) {
        type = new TypeVariable(last)
      }
      else if (ast.isClassDeclaration(last)) {
        type = new ClassType(last.name, last)
      }
      return type
    },

    VariableDeclaration: (element) => {
      if (element.type) {
        return this.inferType(element.type) ?? this.classTypeOf('any')
      }
      else if (element.initializer) {
        return this.inferType(element.initializer) ?? this.classTypeOf('any')
      }
    },

    FunctionDeclaration: (element) => {
      const params = element.params.map(it => this.inferType(it) ?? this.classTypeOf('any'))
      const ret = this.inferType(element.retType) ?? this.classTypeOf('any')
      return new FunctionType(params, ret)
    },

    FieldDeclaration: (element) => {
      if (element.type) {
        return this.inferType(element.type) ?? this.classTypeOf('any')
      }
      else if (element.initializer) {
        return this.inferType(element.initializer) ?? this.classTypeOf('any')
      }
      else {
        return this.classTypeOf('any')
      }
    },

    LoopParameter: (element) => {
      const length = element.$container.params.length
      const index = element.$containerIndex
      if (index === undefined) {
        return
      }
      const rangeType = this.inferType(element.$container.range)
      if (!rangeType) {
        return
      }

      const operator = this.memberProvider()
        .streamMembers(rangeType).filter(ast.isOperatorFunctionDeclaration)
        .filter(it => it.operator === 'for')
        .filter(it => it.params.length === length)
        .head()

      let paramType = this.inferType(operator?.params.at(index))
      if (isClassType(rangeType) && rangeType.subst) {
        paramType = paramType?.applySubst(rangeType.subst)
      }
      return paramType
    },

    ValueParameter: (element) => {
      if (element.type) {
        return this.inferType(element.type)
      }

      if (element.defaultValue && ast.isExpression(element.defaultValue)) {
        return this.inferType(element.defaultValue)
      }

      if (ast.isFunctionExpression(element.$container)) {
        const funcExpr = element.$container
        const index = element.$containerIndex!

        let expected: Type | undefined
        if (ast.isAssignmentExpression(funcExpr.$container) && funcExpr.$container.operator === '=') {
          expected = this.inferType(funcExpr.$container.left)
        }
        else if (ast.isVariableDeclaration(funcExpr.$container)) {
          expected = this.inferType(funcExpr.$container.type)
        }
        else if (ast.isCallExpression(funcExpr.$container)) {
          const callArgIndex = funcExpr.$containerIndex!
          const receiverType = this.inferType(funcExpr.$container.receiver)
          expected = isFunctionType(receiverType) ? receiverType.params.at(callArgIndex) : receiverType
        }

        if (isAnyType(expected)) {
          return expected
        }
        else if (isFunctionType(expected)) {
          return expected.params.at(index)
        }
        else if (isClassType(expected)) {
          const lambdaDecl = this.memberProvider()
            .streamMembers(expected)
            .filter(ast.isFunctionDeclaration)
            .filter(it => it.variance === 'lambda')
            .head()
          return this.inferType(lambdaDecl?.params.at(index))
        }
      }
    },

    AssignmentExpression: (element) => {
      switch (element.operator) {
        case '&=':
        case '|=':
        case '^=':
        case '+=':
        case '-=':
        case '*=':
        case '/=':
        case '%=':
        case '~=':{
          const leftType = this.inferType(element.left)
          const operator = this.memberProvider()
            .streamMembers(leftType)
            .filter(ast.isOperatorFunctionDeclaration)
            .filter(it => it.operator === element.operator)
            .filter(it => it.params.length === 1)
            .head()
          let retType = this.inferType(operator?.retType)
          if (isClassType(leftType) && leftType.subst) {
            retType = retType?.applySubst(leftType.subst)
          }
          return retType
        }

        case '=': {
          if (ast.isIndexExpression(element.left)) {
            const operator = this.memberProvider()
              .streamMembers(element.left)
              .filter(ast.isOperatorFunctionDeclaration)
              .filter(it => it.operator === '[]=')
              .filter(it => it.params.length === 2)
              .head()
            return this.inferType(operator?.retType)
          }
          else {
            return this.inferType(element.right)
          }
        }
      }
    },

    ConditionalExpression: (element) => {
      return this.inferType(element.thenBody) ?? this.inferType(element.elseBody)
    },

    PrefixExpression: (element) => {
      const exprType = this.inferType(element.expr)
      switch (element.operator) {
        case '-':
        case '!': {
          const operator = this.memberProvider()
            .streamMembers(exprType)
            .filter(ast.isOperatorFunctionDeclaration)
            .filter(it => it.operator === element.operator)
            .filter(it => it.params.length === 0)
            .head()
          return this.inferType(operator?.retType)
        }
      }
    },

    InfixExpression: (element) => {
      const leftType = this.inferType(element.left)
      switch (element.operator) {
        case '&': // Bitwise
        case '|':
        case '^':
        case '+': // Arithmetic
        case '-':
        case '*':
        case '/':
        case '%':
        case '<': // Comparison
        case '>':
        case '<=':
        case '>=':
        case '==':
        case '!=': {
          const operator = this.memberProvider()
            .streamMembers(leftType)
            .filter(ast.isOperatorFunctionDeclaration)
            .filter(it => it.operator === element.operator)
            .filter(it => it.params.length === 1)
            .head()
          return this.inferType(operator?.retType)
        }
        case 'has': // Containment
        case 'in': {
          const operator = this.memberProvider()
            .streamMembers(leftType)
            .filter(ast.isOperatorFunctionDeclaration)
            .filter(it => it.operator === 'has')
            .filter(it => it.params.length === 1)
            .head()
          return this.inferType(operator?.retType)
        }

        case '&&': // Logical
        case '||':
          return this.classTypeOf('bool')

        case '~': // String Concat
          return this.classTypeOf('string')
      }
    },

    IntRangeExpression: (element) => {
      const leftType = this.inferType(element.from)
      const operator = this.memberProvider()
        .streamMembers(leftType)
        .filter(ast.isOperatorFunctionDeclaration)
        .filter(it => it.operator === '..')
        .filter(it => it.params.length === 1)
        .head()
      return this.inferType(operator?.retType)
    },

    TypeCastExpression: (element) => {
      return this.inferType(element.type)
    },

    InstanceofExpression: () => {
      return this.classTypeOf('bool')
    },

    ParenthesizedExpression: (element) => {
      return this.inferType(element.expr)
    },

    BracketExpression: (element) => {
      const id = element.path.map(it => it.$cstNode?.text).join(':')
      const type = this.bracketManager.findType(id)
      if (!type) {
        return this.classTypeOf('any')
      }

      const types = type.split('&').map(it => this.classTypeOf(it.trim()))
      switch (types.length) {
        case 1:
          return types[0]

        default:
          return new IntersectionType(types)
      }
    },

    FunctionExpression: (element) => {
      const params = element.params.map(param => this.inferType(param) ?? this.classTypeOf('any'))
      const ret = this.inferType(element.retType) ?? this.classTypeOf('any')
      return new FunctionType(params, ret)
    },

    ReferenceExpression: (element) => {
      return this.inferType(element.entity.ref) ?? this.classTypeOf('any')
    },

    AccessExpression: (element) => {
      const receiverType = this.inferType(element.receiver)

      // Recursive Guard
      const _ref = (element.entity as any)._ref
      if (typeof _ref === 'symbol' && _ref.description === 'ref_resolving') {
        return this.classTypeOf('any')
      }

      const entityContainer = element.entity.ref?.$container
      if (ast.isOperatorFunctionDeclaration(entityContainer) && entityContainer.operator === '.') {
        let retType = this.inferType(entityContainer.retType)
        if (retType && isClassType(receiverType) && receiverType.subst) {
          retType = retType.applySubst(receiverType.subst)
        }
        return retType
      }

      let entityType = this.inferType(element.entity.ref)
      if (entityType && isClassType(receiverType) && receiverType.subst) {
        entityType = entityType.applySubst(receiverType.subst)
      }
      return entityType
    },

    IndexExpression: (element) => {
      const receiverType = this.inferType(element.receiver)
      if (isAnyType(receiverType)) {
        return receiverType
      }
      const operator = this.memberProvider()
        .streamMembers(element.receiver)
        .filter(ast.isOperatorFunctionDeclaration)
        .filter(it => it.operator === '[]')
        .filter(it => it.params.length === 1)
        .head()
      let retType = this.inferType(operator?.retType)
      if (isClassType(receiverType) && receiverType.subst) {
        retType = retType?.applySubst(receiverType.subst)
      }
      return retType
    },

    CallExpression: (element) => {
      if (ast.isReferenceExpression(element.receiver) || ast.isAccessExpression(element.receiver)) {
        const receiver = element.receiver.entity.ref
        if (!receiver) {
          return
        }
        if (ast.isConstructorDeclaration(receiver)) {
          const classDecl = AstUtils.getContainerOfType(receiver, ast.isClassDeclaration)
          if (!classDecl) {
            return
          }
          return new ClassType(classDecl.name, classDecl)
        }
      }
      const receiverType = this.inferType(element.receiver)
      if (isFunctionType(receiverType)) {
        return receiverType.ret
      }
      if (isAnyType(receiverType)) {
        return receiverType
      }
    },

    NullLiteral: () => {
      // does it make sense?
      return this.classTypeOf('any')
    },

    BooleanLiteral: () => {
      return this.classTypeOf('bool')
    },

    IntegerLiteral: (element) => {
      switch (element.value.at(-1)) {
        case 'l':
        case 'L':
          return this.classTypeOf('long')

        default:
          return this.classTypeOf('int')
      }
    },

    FloatLiteral: (element) => {
      switch (element.value.at(-1)) {
        case 'f':
        case 'F':
          return this.classTypeOf('float')

        case 'd':
        case 'D':
        default:
          return this.classTypeOf('double')
      }
    },

    StringLiteral: () => {
      return this.classTypeOf('string')
    },

    UnquotedString: () => {
      return this.classTypeOf('string')
    },

    StringTemplate: () => {
      return this.classTypeOf('string')
    },

    ArrayLiteral: () => {
      const type = this.classTypeOf('Array')
      type.updateSubst(() => type.decl?.typeParams.find(it => it.name === 'T'), () => this.classTypeOf('any'))
      return type
    },

    MapLiteral: () => {
      const type = this.classTypeOf('Map')
      type.updateSubst(() => type.decl?.typeParams.find(it => it.name === 'K'), () => this.classTypeOf('string'))
      type.updateSubst(() => type.decl?.typeParams.find(it => it.name === 'V'), () => this.classTypeOf('any'))
      return type
    },
  })
}
