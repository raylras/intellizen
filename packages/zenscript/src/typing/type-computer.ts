import type { AstNode } from 'langium'
import type { ZenScriptServices } from '../module'
import type { MemberProvider } from '../reference/member-provider'
import type { ZenScriptSyntheticAstType } from '../reference/synthetic'
import type { BracketManager } from '../workspace/bracket-manager'
import type { PackageManager } from '../workspace/package-manager'
import type { BuiltinTypes, Substitution, Type } from './type-description'
import { Map as ImmutableMap } from 'immutable'
import { AstUtils } from 'langium'
import * as ast from '../generated/ast'
import { defineRules } from '../utils/rule'
import { applySubstIfPresent, ClassType, CompoundType, FunctionType, IntersectionType, isAnyType, isClassType, isFunctionType, TypeVariable } from './type-description'

type RuleSpec = ast.ZenScriptAstType & ZenScriptSyntheticAstType
type RuleMap = { [K in keyof RuleSpec]?: (element: RuleSpec[K], env: Gamma) => Type | undefined }
type Gamma = ImmutableMap<string, Type>

export interface TypeComputer {
  inferType: (node: AstNode | undefined, env?: Gamma) => Type | undefined
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

  public inferType(node: AstNode | undefined, env: Gamma = ImmutableMap()): Type | undefined {
    return this.inferRules(node?.$type)?.call(this, node, env)
  }

  private classTypeOf(className: BuiltinTypes | string, subst?: Substitution): ClassType {
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
    ArrayType: (element, env) => {
      const type = this.classTypeOf('Array')
      type.addSubst('T', () => this.inferType(element.value, env))
      return type
    },

    ListType: (element, env) => {
      const type = this.classTypeOf('List')
      type.addSubst('T', () => this.inferType(element.value, env))
      return type
    },

    MapType: (element, env) => {
      const type = this.classTypeOf('Map')
      type.addSubst('K', () => this.inferType(element.key, env))
      type.addSubst('V', () => this.inferType(element.value, env))
      return type
    },

    CompoundType: (element, env) => {
      const types = element.values.map(it => this.inferType(it, env) ?? this.classTypeOf('ERROR'))
      return new CompoundType(types)
    },

    ParenthesizedType: (element, env) => {
      return this.inferType(element.value, env)
    },

    FunctionType: (element, env) => {
      const params = element.params.map(it => this.inferType(it, env) ?? this.classTypeOf('any'))
      const ret = this.inferType(element.retType, env) ?? this.classTypeOf('any')
      return new FunctionType(params, ret)
    },

    NamedType: (element) => {
      const entity = element.item.entity?.ref
      if (ast.isTypeParameter(entity)) {
        return new TypeVariable(entity)
      }
      else if (ast.isClassDeclaration(entity)) {
        return new ClassType(entity.name, entity)
      }
    },

    ImportDeclaration: (element, env) => {
      return this.inferType(element.item.entity.ref, env)
    },

    VariableDeclaration: (element, env) => {
      if (element.type) {
        return this.inferType(element.type, env) ?? this.classTypeOf('any')
      }
      else if (element.initializer) {
        return this.inferType(element.initializer, env) ?? this.classTypeOf('any')
      }
    },

    FunctionDeclaration: (element, env) => {
      const params = element.params.map(it => this.inferType(it, env) ?? this.classTypeOf('any'))
      const ret = this.inferType(element.retType, env) ?? this.classTypeOf('any')
      return new FunctionType(params, ret)
    },

    FieldDeclaration: (element, env) => {
      if (element.type) {
        return this.inferType(element.type, env) ?? this.classTypeOf('any')
      }
      else if (element.initializer) {
        return this.inferType(element.initializer, env) ?? this.classTypeOf('any')
      }
      else {
        return this.classTypeOf('any')
      }
    },

    LoopParameter: (element, env) => {
      const index = element.$containerIndex
      if (index === undefined) {
        return
      }

      const rangeType = this.inferType(element.$container.range, env)
      if (!rangeType) {
        return
      }

      const length = element.$container.params.length
      const operator = this.memberProvider()
        .streamMembers(rangeType)
        .filter(ast.isOperatorFunctionDeclaration)
        .filter(it => it.operator === 'for')
        .filter(it => it.params.length === length)
        .head()

      const paramType = this.inferType(operator?.params.at(index), env)
      return isClassType(rangeType) ? paramType?.applySubst(rangeType.subst) : paramType
    },

    ValueParameter: (element, env) => {
      if (element.type) {
        return this.inferType(element.type, env)
      }
      else if (element.defaultValue) {
        return this.inferType(element.defaultValue, env)
      }
      else if (ast.isFunctionExpression(element.$container)) {
        const container = element.$container
        const index = element.$containerIndex!

        const container2 = container.$container
        const index2 = container.$containerIndex!

        let expect: Type | undefined
        if (ast.isAssignmentExpression(container2) && container2.operator === '=') {
          expect = this.inferType(container2.left, env)
        }
        else if (ast.isVariableDeclaration(container2)) {
          expect = this.inferType(container2.type, env)
        }
        else if (ast.isCallExpression(container2)) {
          const receiverType = this.inferType(container2.receiver, env)
          expect = isFunctionType(receiverType) ? receiverType.params.at(index2) : undefined
        }
        else if (ast.isAccessExpression(container2)) {
          const entityType = this.inferType(container2.entity.ref, env)
          expect = isFunctionType(entityType) ? entityType.params.at(index2) : undefined
        }
        else {
          expect = undefined
        }

        if (isAnyType(expect)) {
          return expect
        }
        else if (isFunctionType(expect)) {
          return expect.params.at(index)
        }
        else if (isClassType(expect)) {
          const lambda = this.memberProvider()
            .streamMembers(expect)
            .filter(ast.isFunctionDeclaration)
            .filter(it => it.variance === 'lambda')
            .head()
          return this.inferType(lambda?.params.at(index), env)
        }
      }
    },

    AssignmentExpression: (element, env) => {
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
          const leftType = this.inferType(element.left, env)
          const operator = this.memberProvider()
            .streamMembers(leftType)
            .filter(ast.isOperatorFunctionDeclaration)
            .filter(it => it.operator === element.operator)
            .filter(it => it.params.length === 1)
            .head()
          const retType = this.inferType(operator?.retType, env)
          return isClassType(leftType) ? retType?.applySubst(leftType.subst) : retType
        }

        case '=': {
          if (ast.isIndexExpression(element.left)) {
            const operator = this.memberProvider()
              .streamMembers(element.left)
              .filter(ast.isOperatorFunctionDeclaration)
              .filter(it => it.operator === '[]=')
              .filter(it => it.params.length === 2)
              .head()
            return this.inferType(operator?.retType, env)
          }
          else {
            return this.inferType(element.right, env)
          }
        }
      }
    },

    ConditionalExpression: (element, env) => {
      return this.inferType(element.thenBody, env) ?? this.inferType(element.elseBody, env)
    },

    PrefixExpression: (element, env) => {
      const exprType = this.inferType(element.expr, env)
      const operator = this.memberProvider()
        .streamMembers(exprType)
        .filter(ast.isOperatorFunctionDeclaration)
        .filter(it => it.operator === element.operator)
        .filter(it => it.params.length === 0)
        .head()
      return this.inferType(operator?.retType, env)
    },

    InfixExpression: (element, env) => {
      const leftType = this.inferType(element.left, env)
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
          return this.inferType(operator?.retType, env)
        }
        case 'has': // Containment
        case 'in': {
          const operator = this.memberProvider()
            .streamMembers(leftType)
            .filter(ast.isOperatorFunctionDeclaration)
            .filter(it => it.operator === 'has')
            .filter(it => it.params.length === 1)
            .head()
          return this.inferType(operator?.retType, env)
        }

        case '&&': // Logical
        case '||':
          return this.classTypeOf('bool')

        case '~': // String Concat
          return this.classTypeOf('string')
      }
    },

    IntRangeExpression: (element, env) => {
      const leftType = this.inferType(element.from, env)
      const operator = this.memberProvider()
        .streamMembers(leftType)
        .filter(ast.isOperatorFunctionDeclaration)
        .filter(it => it.operator === '..')
        .filter(it => it.params.length === 1)
        .head()
      return this.inferType(operator?.retType, env)
    },

    TypeCastExpression: (element, env) => {
      return this.inferType(element.type, env)
    },

    InstanceofExpression: () => {
      return this.classTypeOf('bool')
    },

    ParenthesizedExpression: (element, env) => {
      return this.inferType(element.expr, env)
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

    FunctionExpression: (element, env) => {
      const params = element.params.map(param => this.inferType(param, env) ?? this.classTypeOf('any'))
      const ret = this.inferType(element.retType, env) ?? this.classTypeOf('any')
      return new FunctionType(params, ret)
    },

    ReferenceExpression: (element, env) => {
      const name = element.entity.$refText
      const type = env.get(name)
      if (type) {
        return type
      }
      else {
        const newEnv = env.set(name, this.classTypeOf('any'))
        return this.inferType(element.entity.ref, newEnv) ?? this.classTypeOf('any')
      }
    },

    AccessExpression: (element, env) => {
      const entity = element.entity.ref
      const receiverType = this.inferType(element.receiver, env)

      // handle operator overloading
      const entityContainer = entity?.$container
      if (entityContainer && ast.isOperatorFunctionDeclaration(entityContainer) && entityContainer.operator === '.') {
        const retType = this.inferType(entityContainer.retType, env)
        return applySubstIfPresent(receiverType, retType)
      }

      const entityType = this.inferType(entity, env)
      const substituted = applySubstIfPresent(receiverType, entityType)
      if (element.withArgs) {
        return isFunctionType(substituted) ? substituted.ret : undefined
      }
      else {
        return substituted
      }
    },

    IndexExpression: (element, env) => {
      const receiverType = this.inferType(element.receiver, env)
      if (isAnyType(receiverType)) {
        return receiverType
      }
      const operator = this.memberProvider()
        .streamMembers(element.receiver)
        .filter(ast.isOperatorFunctionDeclaration)
        .filter(it => it.operator === '[]')
        .filter(it => it.params.length === 1)
        .head()
      const retType = this.inferType(operator?.retType, env)
      return applySubstIfPresent(receiverType, retType)
    },

    CallExpression: (element, env) => {
      if (ast.isReferenceExpression(element.receiver)) {
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
      const receiverType = this.inferType(element.receiver, env)
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
      type.addSubst('T', () => this.classTypeOf('any'))
      return type
    },

    MapLiteral: () => {
      const type = this.classTypeOf('Map')
      type.addSubst('K', () => this.classTypeOf('string'))
      type.addSubst('V', () => this.classTypeOf('any'))
      return type
    },
  })
}
