import type { AstNode } from 'langium'
import type { ClassDeclaration, Declaration, TypeParameter } from '../generated/ast'
import { isNamed } from 'langium'
import { isNamedType } from '../generated/ast'

// region TypeDescription
export interface ZenScriptType {
  FunctionType: FunctionType
  ClassType: ClassType
  UnionType: UnionType
  IntersectionType: IntersectionType
  CompoundType: CompoundType
  TypeVariable: TypeVariable
  UnknownType: UnknownType
}

export type BuiltinTypes = 'any' | 'bool' | 'byte' | 'short' | 'int' | 'long' | 'float' | 'double' | 'string' | 'void' | 'Array' | 'List' | 'Map' | 'Entry' | 'stanhebben.zenscript.value.IntRange'

export type Substitution = Map<TypeParameter, Type>

export function makeSubst(...entries: [TypeParameter, Type][]): Substitution {
  return new Map(entries)
}

export function applySubstIfPresent(from: Type | undefined, to: Type | undefined): Type | undefined {
  return isClassType(from) ? to?.applySubst(from.subst) : to
}

export function getSubstType(type: ClassType, name: string): Type | undefined {
  const tp = type.decl?.typeParams.find(it => it.name === name)
  return type?.subst?.get(tp!)
}

export interface Type {
  $type: string
  applySubst: (subst: Substitution | undefined) => Type
  toString: () => string
}

export interface NamedType<D extends Declaration> extends Type {
  decl?: D
}

export class ClassType implements NamedType<ClassDeclaration> {
  $type = 'ClassType'
  name: string
  decl?: ClassDeclaration
  subst?: Substitution
  constructor(name: string, decl?: ClassDeclaration, subst?: Substitution) {
    this.name = name
    this.decl = decl
    this.subst = subst
  }

  applySubst(subst: Substitution | undefined): Type {
    if (!subst?.size) {
      return this
    }
    const newSubst = new Map(this.subst?.entries().map(([p, t]) => [p, t.applySubst(subst)]))
    return new ClassType(this.name, this.decl, newSubst)
  }

  addSubst(name: string, type: () => Type | undefined): void {
    if (!this.subst) {
      this.subst = makeSubst()
    }
    const p = this.decl?.typeParams.find(it => it.name === name)
    if (p) {
      const t = type()
      if (t) {
        this.subst.set(p, t)
      }
    }
  }

  toString(): string {
    let result = this.name
    if (this.decl?.typeParams.length) {
      result += '<'
      result += this.decl.typeParams
        .map(it => this.subst?.get(it)?.toString() ?? it.name)
        .join(', ')
      result += '>'
    }
    return result
  }
}

export class TypeVariable implements NamedType<TypeParameter> {
  $type = 'TypeVariable'
  decl: TypeParameter
  constructor(decl: TypeParameter) {
    this.decl = decl
  }

  applySubst(subst: Substitution | undefined): Type {
    return subst?.get(this.decl) ?? this
  }

  toString(): string {
    return this.decl.name
  }
}

export class FunctionType implements Type {
  $type = 'FunctionType'
  params: Type[]
  ret: Type
  constructor(params: Type[], ret: Type) {
    this.params = params
    this.ret = ret
  }

  applySubst(subst: Substitution | undefined) {
    const newParams = this.params.map(it => it.applySubst(subst))
    const newRet = this.ret.applySubst(subst)
    return new FunctionType(newParams, newRet)
  }

  toString(): string {
    let result = 'function('
    if (this.params.length) {
      result += this.params.map(it => it.toString()).join(',')
    }
    result += ')'
    result += this.ret.toString()
    return result
  }
}

export class UnionType implements Type {
  $type = 'UnionType'
  types: Type[]
  constructor(types: Type[]) {
    this.types = types
  }

  applySubst(subst: Substitution | undefined) {
    return new UnionType(this.types.map(it => it.applySubst(subst)))
  }

  toString(): string {
    return this.types.map(it => it.toString()).join(' | ')
  }
}

export class IntersectionType implements Type {
  $type = 'IntersectionType'
  types: Type[]
  constructor(types: Type[]) {
    this.types = types
  }

  applySubst(subst: Substitution | undefined) {
    return new IntersectionType(this.types.map(it => it.applySubst(subst)))
  }

  toString(): string {
    return this.types.map(it => it.toString()).join(' & ')
  }
}

export class CompoundType implements Type {
  $type = 'CompoundType'
  types: Type[]
  constructor(types: Type[]) {
    this.types = types
  }

  applySubst(subst: Substitution | undefined) {
    return new CompoundType(this.types.map(it => it.applySubst(subst)))
  }

  toString(): string {
    return this.types.map(it => it.toString()).join(', ')
  }
}

export class UnknownType implements Type {
  readonly $type = 'UnknownType'
  readonly name?: string
  readonly node?: AstNode

  constructor(options?: { name?: string, node?: AstNode }) {
    this.node = options?.node
    if (typeof options?.name === 'string') {
      this.name = options.name
    }
    else if (options?.node) {
      if (isNamed(options.node)) {
        this.name = options.node.name
      }
      else if (isNamedType(options.node)) {
        this.name = options.node.item.entity.$refText
      }
    }
  }

  applySubst(_subst: Substitution | undefined): Type {
    return this
  }

  toString(): string {
    return this.name ?? '?'
  }
}
// endregion

// region Predicates
export function isClassType(type: unknown): type is ClassType {
  return type instanceof ClassType
}

export function isStringType(type: unknown): type is ClassType {
  return isClassType(type) && type.name === 'string'
}

export function isAnyType(type: unknown): type is ClassType {
  return isClassType(type) && type.name === 'any'
}

export function isBoolType(type: unknown): type is ClassType {
  return isClassType(type) && type.name === 'bool'
}

export function isByteType(type: unknown): type is ClassType {
  return isClassType(type) && type.name === 'byte'
}

export function isShortType(type: unknown): type is ClassType {
  return isClassType(type) && type.name === 'short'
}

export function isIntType(type: unknown): type is ClassType {
  return isClassType(type) && type.name === 'int'
}

export function isLongType(type: unknown): type is ClassType {
  return isClassType(type) && type.name === 'long'
}

export function isFloatType(type: unknown): type is ClassType {
  return isClassType(type) && type.name === 'float'
}

export function isDoubleType(type: unknown): type is ClassType {
  return isClassType(type) && type.name === 'double'
}

export function isVoidType(type: unknown): type is ClassType {
  return isClassType(type) && type.name === 'void'
}

export function isArrayType(type: unknown): type is ClassType {
  return isClassType(type) && type.name === 'Array'
}

export function isListType(type: unknown): type is ClassType {
  return isClassType(type) && type.name === 'List'
}

export function isMapType(type: unknown): type is ClassType {
  return isClassType(type) && type.name === 'Map'
}

export function isFunctionType(type: unknown): type is FunctionType {
  return type instanceof FunctionType
}

export function isUnionType(type: unknown): type is UnionType {
  return type instanceof UnionType
}

export function isIntersectionType(type: unknown): type is IntersectionType {
  return type instanceof IntersectionType
}

export function isCompoundType(type: unknown): type is CompoundType {
  return type instanceof CompoundType
}

export function isTypeVariable(type: unknown): type is TypeVariable {
  return type instanceof TypeVariable
}

export function isUnknownType(type: unknown): type is UnknownType {
  return type instanceof UnknownType
}
// endregion
