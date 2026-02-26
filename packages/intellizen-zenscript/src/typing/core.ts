/* eslint-disable ts/no-redeclare */
/* eslint-disable prefer-template */

/*
  Thoughts:
    - How should `ClassContext` be designed? []
      - We need to scan all documents and build a central index for all declarations []
      - Maybe we should call it `GlobalIndex`? []

    - How to solve the inconsistency between central index and source files? []
      - When the source file changes, how should the central index be updated? []
*/

export type Type
  = | TyBuiltin
    | TyArray
    | TyList
    | TyMap
    | TyFun
    | TyNamed
    | TyVar
    | TyApp
    | TyAlt
    | TyUnknown

export interface TyBuiltin { tag: 'TyBuiltin', prim: Primitive }
export function tyBuiltin(prim: Primitive): TyBuiltin { return { tag: 'TyBuiltin', prim } }

export type Primitive = 'any' | 'void' | 'bool' | 'byte' | 'short' | 'int' | 'long' | 'float' | 'double' | 'string'
export function tyAny(): TyBuiltin { return tyBuiltin('any') }
export function tyVoid(): TyBuiltin { return tyBuiltin('void') }
export function tyBool(): TyBuiltin { return tyBuiltin('bool') }
export function tyByte(): TyBuiltin { return tyBuiltin('byte') }
export function tyShort(): TyBuiltin { return tyBuiltin('short') }
export function tyInt(): TyBuiltin { return tyBuiltin('int') }
export function tyLong(): TyBuiltin { return tyBuiltin('long') }
export function tyFloat(): TyBuiltin { return tyBuiltin('float') }
export function tyDouble(): TyBuiltin { return tyBuiltin('double') }
export function tyString(): TyBuiltin { return tyBuiltin('string') }

export interface TyArray { tag: 'TyArray', base: Type }
export function tyArray(base: Type): TyArray { return { tag: 'TyArray', base } }

export interface TyList { tag: 'TyList', base: Type }
export function tyList(base: Type): TyList { return { tag: 'TyList', base } }

export interface TyMap { tag: 'TyMap', key: Type, value: Type }
export function tyMap(key: Type, value: Type): TyMap { return { tag: 'TyMap', key, value } }

export interface TyFun { tag: 'TyFun', args: Type[], ret: Type }
export function tyFun(args: Type[], ret: Type): TyFun { return { tag: 'TyFun', args, ret } }

export interface TyNamed { tag: 'TyNamed', fqName: string }
export function tyNamed(fqName: string): TyNamed { return { tag: 'TyNamed', fqName } }

export interface TyVar { tag: 'TyVar', name: string }
export function tyVar(name: string): TyVar { return { tag: 'TyVar', name } }

export interface TyApp { tag: 'TyApp', fun: Type, args: Type[] }
export function tyApp(fun: Type, args: Type[]): TyApp { return { tag: 'TyApp', fun, args } }

export interface TyAlt { tag: 'TyAlt', types: Type[] }
export function tyAlt(types: Type[]): TyAlt { return { tag: 'TyAlt', types } }

export interface TyUnknown { tag: 'TyUnknown' }
export function tyUnknown(): TyUnknown { return { tag: 'TyUnknown' } }

export interface TypeToString {
  toString: (ty: Type) => string
}

export interface TypeEquality {
  areTypesEqual: (t1: Type, t2: Type) => boolean
}

export interface TypeAssignability {
  /**
   *  target := source
   */
  isAssignable: (target: Type, source: Type, psi: ClassContext) => boolean
}

export interface SubType {
  /**
   * sub <: sup
   */
  isSubtype: (sub: Type, sup: Type, psi: ClassContext) => boolean
}

export interface TypeConversion {
  /**
   * implicit type caster
   */
  isConvertible: (from: Type, to: Type, psi: ClassContext) => boolean
}

export type TypeFeatures = TypeToString & TypeEquality & TypeAssignability & SubType & TypeConversion

export interface ClassContext {
  lookupClass: (fqName: string | undefined) => ClassDescription | undefined
  lookupSupers: (fqName: string | undefined) => Generator<ClassDescription>
}

export interface ClassDescription {
  /**
   * fully qualified name
   */
  fqName: string

  /**
   * simple name
   */
  name: string

  /**
   * immediate super types
   */
  supers: TyNamed[]

  /**
   * type parameters
   */
  typeParams: string[]

  /**
   * field signatures
   */
  fields: FieldDescription[]

  /**
   *  method signatures
   */
  methods: FunctionDescription[]
}

export interface FunctionDescription {
  /**
   * simple name
   */
  name: string

  /**
   * value parameters
   */
  params: ValueParameterDescription[]

  /**
   * return type
   */
  retType: Type
}

export interface ValueParameterDescription {
  /**
   * simple name
   */
  name: string

  /**
   * type
   */
  typ: Type
}

export interface FieldDescription {
  /**
   * simple name
   */
  name: string

  /**
   * type
   */
  typ: Type
}

export const TypeFeatures: TypeFeatures = {
  areTypesEqual: (t1, t2) => {
    if (t1 === undefined || t2 === undefined) {
      return false
    }

    switch (t1.tag) {
      case 'TyBuiltin':
        return t2.tag === 'TyBuiltin'
          && t1.prim === t2.prim

      case 'TyArray':
        return t2.tag === 'TyArray'
          && TypeFeatures.areTypesEqual(t1.base, t2.base)

      case 'TyList':
        return t2.tag === 'TyList'
          && TypeFeatures.areTypesEqual(t1.base, t2.base)

      case 'TyMap':
        return t2.tag === 'TyMap'
          && TypeFeatures.areTypesEqual(t1.key, t2.key)
          && TypeFeatures.areTypesEqual(t1.value, t2.value)

      case 'TyFun':
        return t2.tag === 'TyFun'
          && TypeFeatures.areTypesEqual(t1.ret, t2.ret)
          && t1.args.length === t2.args.length
          && t1.args.every((t1i, i) => TypeFeatures.areTypesEqual(t1i, t2.args[i]))

      case 'TyNamed':
        return t2.tag === 'TyNamed'
          && t1.fqName === t2.fqName

      case 'TyVar':
        return t2.tag === 'TyVar'
          && t1.name === t2.name

      case 'TyApp':
        return t2.tag === 'TyApp'
          && TypeFeatures.areTypesEqual(t1.fun, t2.fun)
          && t1.args.length === t2.args.length
          && t1.args.every((t1i, i) => TypeFeatures.areTypesEqual(t1i, t2.args[i]))

      case 'TyAlt':
        return false

      case 'TyUnknown':
        return t2.tag === 'TyUnknown'

      default:
        throw new Error('Not implemented', t1)
    }
  },

  isSubtype: (sub, sup, psi) => {
    if (sub === undefined || sup === undefined) {
      return false
    }

    switch (sub.tag) {
      case 'TyNamed':
        return sup.tag === 'TyNamed'
          && psi.lookupSupers(sub.fqName).some(it => it.name === sup.fqName)

      case 'TyBuiltin':
      case 'TyArray':
      case 'TyList':
      case 'TyMap':
      case 'TyFun':
      case 'TyVar':
      case 'TyApp':
      case 'TyAlt':
      case 'TyUnknown':
        return false

      default:
        throw new Error('Not implemented', sub)
    }
  },

  // A straightforward implementation, it seems a bit costly
  isAssignable: (target, source, psi) => {
    if (target === undefined || source === undefined) {
      return false
    }

    // 1. are both types equal?
    if (TypeFeatures.areTypesEqual(target, source)) {
      return true
    }

    // 2. implicit conversion from source to target possible?
    else if (TypeFeatures.isConvertible(source, target, psi)) {
      return true
    }

    // 3. is the source a subtype of the target?
    else {
      return TypeFeatures.isSubtype(source, target, psi)
    }
  },

  toString: (ty) => {
    switch (ty.tag) {
      case 'TyBuiltin':
        return ty.prim

      case 'TyArray':
        return TypeFeatures.toString(ty.base) + '[]'

      case 'TyList':
        return '[' + TypeFeatures.toString(ty.base) + ']'

      case 'TyMap':
        return TypeFeatures.toString(ty.value) + '[' + TypeFeatures.toString(ty.key) + ']'

      case 'TyFun':
        return 'function('
          + ty.args.map(TypeFeatures.toString).join(',')
          + ')'
          + TypeFeatures.toString(ty.ret)

      case 'TyNamed':
        return ty.fqName

      case 'TyVar':
        return ty.name

      case 'TyApp':
        return TypeFeatures.toString(ty.fun)
          + '<'
          + ty.args.map(TypeFeatures.toString).join(',')
          + '>'

      case 'TyAlt':
        return ty.types.map(TypeFeatures.toString).join(',')

      case 'TyUnknown':
        return '?'

      default:
        throw new Error('Not implemented', ty)
    }
  },

  isConvertible: (from, to, psi) => {
    // TODO
    return false
  },
}

function testTypeToString() {
  // eslint-disable-next-line no-console
  const log = console.log
  const show = (ty: Type) => log(ty, TypeFeatures.toString(ty))

  log('test: TypeToString')

  show(tyAny())
  show(tyArray(tyBool()))
  show(tyNamed('Foo'))
  show(tyApp(tyNamed('Map'), [tyVar('K'), tyVar('V')]))
}

function testTypeEquality() {
  // eslint-disable-next-line no-console
  const log = console.log
  const show = (t1: Type, t2: Type) => log(t1, t2, TypeFeatures.areTypesEqual(t1, t2))

  log('test: TypeEquality')

  show(tyAny(), tyAny())
  show(tyAny(), tyBool())
  show(tyNamed('Map'), tyNamed('Map'))
  show(tyNamed('Map'), tyNamed('map'))
  show(tyApp(tyNamed('Map'), [tyVar('K'), tyVar('V')]), tyApp(tyNamed('Map'), [tyVar('K'), tyVar('V')]))
  show(tyApp(tyNamed('Map'), [tyVar('K'), tyVar('V')]), tyApp(tyNamed('Map'), [tyVar('K'), tyVar('K')]))
}

function test() {
  testTypeToString()
  testTypeEquality()
}

test()
