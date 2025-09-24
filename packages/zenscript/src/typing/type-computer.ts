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
import { isResolvingReference } from '../reference/scope-provider'
import { defineRules } from '../utils/rule'
import { applySubstIfPresent, ClassType, CompoundType, FunctionType, IntersectionType, isAnyType, isClassType, isFunctionType, TypeVariable, UnknownType } from './type-description'

type RuleSpec = ast.ZenScriptAstType & ZenScriptSyntheticAstType
type RuleMap = { [K in keyof RuleSpec]?: (element: RuleSpec[K], env: TypeEnv) => Type | undefined }
type TypeEnv = ImmutableMap<string, Type>

export interface TypeComputer {
  inferType: (node: AstNode | undefined, env?: TypeEnv) => Type | undefined
  inferTypeOrUnknown: (node: AstNode | undefined, env?: TypeEnv) => Type | UnknownType
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

  inferType(node: AstNode | undefined, env: TypeEnv = ImmutableMap()): Type | undefined {
    return this.inferRules(node?.$type)?.call(this, node, env)
  }

  inferTypeOrUnknown(node: AstNode | undefined, env?: TypeEnv): Type | UnknownType {
    return this.inferType(node, env) ?? new UnknownType({ node })
  }

  private getClassType(className: BuiltinTypes | string, subst?: Substitution): ClassType {
    const decl = this.getClassDecl(className)
    if (!decl) {
      console.error(new Error(`Class "${className}" is not defined.`))
    }
    return new ClassType(decl?.name ?? className, decl, subst)
  }

  private getClassDecl(className: BuiltinTypes | string): ast.ClassDeclaration | undefined {
    return this.packageManager().find(className).values().find(ast.isClassDeclaration)
  }

  private readonly inferRules = defineRules<RuleMap>({
    ArrayType: (element, env) => {
      const type = this.getClassType('Array')
      type.addSubst('T', () => this.inferTypeOrUnknown(element.value, env))
      return type
    },

    ListType: (element, env) => {
      const type = this.getClassType('List')
      type.addSubst('T', () => this.inferTypeOrUnknown(element.value, env))
      return type
    },

    MapType: (element, env) => {
      const type = this.getClassType('Map')
      type.addSubst('K', () => this.inferTypeOrUnknown(element.key, env))
      type.addSubst('V', () => this.inferTypeOrUnknown(element.value, env))
      return type
    },

    CompoundType: (element, env) => {
      const types = element.values.map(it => this.inferTypeOrUnknown(it, env))
      return new CompoundType(types)
    },

    ParenthesizedType: (element, env) => {
      return this.inferTypeOrUnknown(element.value, env)
    },

    FunctionType: (element, env) => {
      const params = element.params.map(it => this.inferTypeOrUnknown(it, env))
      const ret = this.inferTypeOrUnknown(element.retType, env)
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
      return this.inferType(element.item.entity?.ref, env)
    },

    VariableDeclaration: (element, env) => {
      if (element.type) {
        return this.inferTypeOrUnknown(element.type, env)
      }
      else if (element.initializer) {
        return this.inferTypeOrUnknown(element.initializer, env)
      }
      else {
        return this.getClassType('any')
      }
    },

    FunctionDeclaration: (element, env) => {
      const params = element.params.map(it => this.inferTypeOrUnknown(it, env))
      const ret = element.retType ? this.inferTypeOrUnknown(element.retType, env) : this.getClassType('any')
      return new FunctionType(params, ret)
    },

    ExpandFunctionDeclaration: (element, env) => {
      const params = element.params.map(it => this.inferTypeOrUnknown(it, env))
      const ret = element.retType ? this.inferTypeOrUnknown(element.retType, env) : this.getClassType('any')
      return new FunctionType(params, ret)
    },

    FieldDeclaration: (element, env) => {
      if (element.type) {
        return this.inferTypeOrUnknown(element.type, env)
      }
      else if (element.initializer) {
        return this.inferTypeOrUnknown(element.initializer, env)
      }
      else {
        return this.getClassType('any')
      }
    },

    LoopParameter: (element, env) => {
      const index = element.$containerIndex
      if (index === undefined) {
        return new UnknownType({ node: element })
      }

      const forStmt = element.$container
      const rangeType = this.inferType(forStmt.range, env)
      if (!rangeType) {
        return new UnknownType({ node: element })
      }

      const operator = this.memberProvider().getOperator(rangeType, 'for', forStmt.params.length)
      const paramType = this.inferType(operator?.params.at(index), env)
      return applySubstIfPresent(rangeType, paramType) ?? new UnknownType({ node: element })
    },

    ValueParameter: (element, env) => {
      if (env.has(element.name)) {
        return env.get(element.name)
      }

      const newEnv = env.set(element.name, this.getClassType('any'))
      if (element.type) {
        return this.inferType(element.type, newEnv)
      }
      else if (element.defaultValue) {
        return this.inferType(element.defaultValue, newEnv)
      }
      else if (ast.isFunctionExpression(element.$container)) {
        const container = element.$container
        const index = element.$containerIndex!

        const container2 = container.$container
        const index2 = container.$containerIndex!

        let expect: Type | undefined
        if (ast.isTypeCastExpression(container2)) {
          expect = this.inferType(container2.type, newEnv)
        }
        else if (ast.isAssignmentExpression(container2) && container2.operator === '=') {
          expect = this.inferType(container2.left, newEnv)
        }
        else if (ast.isVariableDeclaration(container2)) {
          expect = this.inferType(container2.type, newEnv)
        }
        else if (ast.isCallExpression(container2)) {
          const receiverType = this.inferType(container2.receiver, newEnv)
          expect = isFunctionType(receiverType) ? receiverType.params.at(index2) : undefined
        }
        else if (ast.isAccessExpression(container2)) {
          if (isResolvingReference(container2.entity)) {
            return this.getClassType('any')
          }
          const entityType = this.inferType(container2.entity?.ref, newEnv)
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
          const lambda = this.memberProvider().getLambda(expect)
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
        case '~=': {
          const leftType = this.inferType(element.left, env)
          const operator = this.memberProvider().getOperator(leftType, element.operator, 1)
          const retType = this.inferType(operator?.retType, env)
          return isClassType(leftType) ? retType?.applySubst(leftType.subst) : retType
        }

        case '=': {
          if (ast.isIndexExpression(element.left)) {
            const leftType = this.inferType(element.left)
            const operator = this.memberProvider().getOperator(leftType, '[]=', 2)
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
      const operator = this.memberProvider().getOperator(exprType, element.operator, 0)
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
          const operator = this.memberProvider().getOperator(leftType, element.operator, 1)
          return this.inferType(operator?.retType, env)
        }
        case 'has': // Containment
        case 'in': {
          const operator = this.memberProvider().getOperator(leftType, 'has', 1)
          return this.inferType(operator?.retType, env)
        }

        case '&&': // Logical
        case '||':
          return this.getClassType('bool')

        case '~': // String Concat
          return this.getClassType('string')
      }
    },

    IntRangeExpression: (element, env) => {
      const leftType = this.inferType(element.from, env)
      const operator = this.memberProvider().getOperator(leftType, '..', 1)
      return this.inferType(operator?.retType, env)
    },

    TypeCastExpression: (element, env) => {
      return this.inferType(element.type, env)
    },

    InstanceofExpression: () => {
      return this.getClassType('bool')
    },

    ParenthesizedExpression: (element, env) => {
      return this.inferType(element.expr, env)
    },

    BracketExpression: (element) => {
      const id = element.path.map(it => it.$cstNode?.text).join(':')
      const type = this.bracketManager.findType(id)
      if (!type) {
        return new UnknownType({ node: element })
      }

      const types = type.split('&').map(it => this.getClassType(it.trim()))
      switch (types.length) {
        case 1:
          return types[0]

        default:
          return new IntersectionType(types)
      }
    },

    FunctionExpression: (element, env) => {
      const params = element.params.map(it => this.inferTypeOrUnknown(it, env))
      const ret = element.retType ? this.inferTypeOrUnknown(element.retType, env) : this.getClassType('any')
      return new FunctionType(params, ret)
    },

    ReferenceExpression: (element, env) => {
      const name = element.entity.$refText
      const entity = element.entity.ref
      if (name === 'this') {
        if (ast.isClassDeclaration(entity)) {
          return new ClassType(name, entity)
        }
        else if (ast.isType(entity) && ast.isExpandFunctionDeclaration(entity)) {
          return this.inferType(entity)
        }
      }
      return this.inferType(element.entity?.ref, env)
    },

    AccessExpression: (element, env) => {
      const entity = element.entity?.ref
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
        if (ast.isClassDeclaration(entity)) {
          return new ClassType(entity.name, entity)
        }
        else if (ast.isConstructorDeclaration(entity)) {
          return new ClassType(entity.$container.name, entity.$container)
        }
        else if (isFunctionType(substituted)) {
          return substituted.ret
        }
      }
      else {
        return substituted
      }
    },

    IndexExpression: (element, env) => {
      const receiverType = this.inferType(element.receiver, env)
      const operator = this.memberProvider().getOperator(receiverType, '[]', 1)
      const retType = this.inferType(operator?.retType, env)
      return applySubstIfPresent(receiverType, retType)
    },

    CallExpression: (element, env) => {
      if (ast.isReferenceExpression(element.receiver)) {
        const receiver = element.receiver.entity?.ref
        if (ast.isConstructorDeclaration(receiver)) {
          const classDecl = AstUtils.getContainerOfType(receiver, ast.isClassDeclaration)
          if (!classDecl) {
            return
          }
          return new ClassType(classDecl.name, classDecl)
        }
        else if (ast.isClassDeclaration(receiver)) {
          return new ClassType(receiver.name, receiver)
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
      return this.getClassType('any')
    },

    BooleanLiteral: () => {
      return this.getClassType('bool')
    },

    IntegerLiteral: (element) => {
      switch (element.value.at(-1)) {
        case 'l':
        case 'L':
          return this.getClassType('long')

        default:
          return this.getClassType('int')
      }
    },

    FloatLiteral: (element) => {
      switch (element.value.at(-1)) {
        case 'f':
        case 'F':
          return this.getClassType('float')

        case 'd':
        case 'D':
        default:
          return this.getClassType('double')
      }
    },

    StringLiteral: () => {
      return this.getClassType('string')
    },

    UnquotedString: () => {
      return this.getClassType('string')
    },

    StringTemplate: () => {
      return this.getClassType('string')
    },

    ArrayLiteral: () => {
      const type = this.getClassType('Array')
      type.addSubst('T', () => this.getClassType('any'))
      return type
    },

    MapLiteral: () => {
      const type = this.getClassType('Map')
      type.addSubst('K', () => this.getClassType('string'))
      type.addSubst('V', () => this.getClassType('any'))
      return type
    },
  })
}
