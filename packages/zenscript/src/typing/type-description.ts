import type { ClassDeclaration, Declaration, TypeParameter } from '../generated/ast'

// region TypeDescription
export interface ZenScriptType {
  FunctionType: FunctionType
  ClassType: ClassType
  UnionType: UnionType
  IntersectionType: IntersectionType
  CompoundType: CompoundType
  TypeVariable: TypeVariable
}

export type BuiltinTypes = 'any' | 'bool' | 'byte' | 'short' | 'int' | 'long' | 'float' | 'double' | 'string' | 'void' | 'Array' | 'List' | 'Map' | 'Entry' | 'stanhebben.zenscript.value.IntRange'

export type Subst = Map<TypeParameter, Type>

export function makeSubst(...entries: [TypeParameter, Type][]): Subst {
  return new Map(entries)
}

export interface Type {
  $type: string
  applySubst: (subst: Subst) => Type
  toString: () => string
}

export interface NamedType<D extends Declaration> extends Type {
  decl?: D
}

export class ClassType implements NamedType<ClassDeclaration> {
  $type = 'ClassType'
  name: string
  decl?: ClassDeclaration
  subst?: Subst
  constructor(name: string, decl?: ClassDeclaration, subst?: Subst) {
    this.name = name
    this.decl = decl
    this.subst = subst
  }

  applySubst(subst: Subst): Type {
    const newSubst = new Map(this.subst?.entries().map(([p, t]) => [p, t.applySubst(subst)])) ?? undefined
    return new ClassType(this.name, this.decl, newSubst)
  }

  updateSubst(param: () => TypeParameter | undefined, type: () => Type | undefined) {
    if (!this.subst) {
      this.subst = makeSubst()
    }
    const p = param()
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

  applySubst(subst: Subst): Type {
    return subst.get(this.decl) ?? this
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

  applySubst(subst: Subst) {
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

  applySubst(subst: Subst) {
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

  applySubst(subst: Subst) {
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

  applySubst(subst: Subst) {
    return new CompoundType(this.types.map(it => it.applySubst(subst)))
  }

  toString(): string {
    return this.types.map(it => it.toString()).join(', ')
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
// endregion
