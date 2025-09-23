import type { AstNode } from 'langium'
import type { ZenScriptServices } from '../module'
import type { TypeComputer } from '../typing/type-computer'
import type { FunctionType, Type } from '../typing/type-description'
import type { TypeFeatures } from '../typing/type-features'
import { MultiMap } from 'langium'
import * as ast from '../generated/ast'
import { getSubstType, isArrayType, isFunctionType } from '../typing/type-description'

const ENABLE_OVERLOAD_LOGGING = false
export interface OverloadResolver {
  resolveOverloads: (expr: ast.AccessExpression, maybeCandidates: AstNode[]) => AstNode[]
}

export enum OverloadMatch {
  Exact,
  EqualType,
  Vararg,
  OptionalArg,
  SubType,
  ImplicitCastType,
  CallableProperty,
  MissingArgs,
  TooManyArgs,
  Mismatch,
}

function worstMatch(matchSet: Set<OverloadMatch>): OverloadMatch {
  return Array.from(matchSet).sort().at(-1) ?? OverloadMatch.Mismatch
}

export class ZenScriptOverloadResolver implements OverloadResolver {
  private readonly typeComputer: TypeComputer
  private readonly typeFeatures: TypeFeatures

  constructor(services: ZenScriptServices) {
    this.typeComputer = services.typing.TypeComputer
    this.typeFeatures = services.typing.TypeFeatures
  }

  public resolveOverloads(expr: ast.AccessExpression, maybeCandidates: AstNode[]): AstNode[] {
    const candidates = maybeCandidates.flatMap(maybe => ast.isClassDeclaration(maybe) ? maybe.members.filter(ast.isConstructorDeclaration) : maybe)
    if (candidates.length <= 1) {
      return candidates
    }

    const grouped = candidates.reduce((map, it) => map.add(it.$container!, it), new MultiMap<AstNode, AstNode>())
    for (const container of grouped.keys()) {
      const overloads = this.analyzeOverloads(new Set(grouped.get(container)), expr.args)
      if (overloads.length) {
        return overloads
      }
    }
    if (ENABLE_OVERLOAD_LOGGING) {
      // FIXME
      // For debugging, consider adding a breakpoint here
      console.error(`[Debug/Overload] No overloads: ${expr.entity.$refText}`)
    }

    return candidates
  }

  private analyzeOverloads(candidates: Set<AstNode>, args: ast.Expression[]): AstNode[] {
    const possibles = candidates.values()
      .map(it => ({ candidate: it, match: this.match(it, args) }))
      .filter(it => it.match !== OverloadMatch.Mismatch)
      .toArray()
      .sort((a, b) => a.match - b.match)
    const grouped = Object.groupBy(possibles, it => it.match)
    const bestMatches = Object.values(grouped).at(0) ?? []

    if (bestMatches.length > 1) {
      this.logAmbiguous(possibles, args)
    }

    return bestMatches.map(it => it.candidate)
  }

  private logAmbiguous(possibles: { candidate: AstNode, match: OverloadMatch }[], args: ast.Expression[]) {
    if (!ENABLE_OVERLOAD_LOGGING) {
      return
    }
    const argTypes = args.map(it => this.typeComputer.inferTypeOrUnknown(it).toString()).join(', ')
    console.warn(`[Debug/Overload] Ambiguous (${argTypes})`)
    for (const { candidate, match } of possibles) {
      const name = 'name' in candidate ? candidate.name : 'function'
      const funcType = this.typeComputer.inferType(candidate) as FunctionType
      const paramTypes = funcType.params.map(it => it.toString()).join(', ')
      console.warn(`----- ${OverloadMatch[match]} ${name}(${paramTypes})`)
    }
  }

  private match(candidate: AstNode, args: ast.Expression[]): OverloadMatch {
    const matchSet = new Set([OverloadMatch.Exact])
    if (ast.isCallableDeclaration(candidate)) {
      this.matchCallable(candidate, args, matchSet)
    }
    else if (ast.isFieldDeclaration(candidate)) {
      this.matchFunctionProperty(candidate, args, matchSet)
    }
    else {
      matchSet.add(OverloadMatch.Mismatch)
    }
    return worstMatch(matchSet)
  }

  private matchCallable(callable: ast.CallableDeclaration, args: ast.Expression[], matchSet: Set<OverloadMatch>) {
    const params = [...callable.params]
    const map = this.createParamToArgsMap(params, args)

    if (args.length > map.size) {
      matchSet.add(OverloadMatch.TooManyArgs)
    }

    for (const param of params) {
      const arg = map.get(param).at(0)
      // special checking
      if (param.varargs) {
        matchSet.add(OverloadMatch.Vararg)
        if (!arg) {
          continue
        }
      }
      else if (param.defaultValue) {
        matchSet.add(OverloadMatch.OptionalArg)
        if (!arg) {
          continue
        }
      }
      else {
        if (!arg) {
          matchSet.add(OverloadMatch.MissingArgs)
          break
        }
      }

      // type checking
      const paramType = this.typeComputer.inferType(param)
      const argType = this.typeComputer.inferType(arg)
      if (!paramType || !argType) {
        matchSet.add(OverloadMatch.ImplicitCastType)
      }
      else if (param.varargs && isArrayType(argType)) {
        this.matchType(paramType, getSubstType(argType, 'T')!, matchSet)
      }
      else {
        this.matchType(paramType, argType, matchSet)
      }
    }
  }

  private createParamToArgsMap(params: ast.ValueParameter[], args: ast.Expression[]): MultiMap<ast.ValueParameter, ast.Expression> {
    const map = new MultiMap<ast.ValueParameter, ast.Expression>()
    for (let a = 0, p = 0, arg = args[a], param = params[p]; a < args.length && p < params.length;) {
      if (arg) {
        map.add(param, arg)
        arg = args[++a]
      }
      if (!param.varargs) {
        param = params[++p]
      }
    }
    return map
  }

  private matchFunctionProperty(property: ast.FieldDeclaration, args: ast.Expression[], matchSet: Set<OverloadMatch>) {
    matchSet.add(OverloadMatch.CallableProperty)

    const funcType = this.typeComputer.inferType(property)
    if (!isFunctionType(funcType)) {
      matchSet.add(OverloadMatch.Mismatch)
      return
    }

    if (funcType.params.length !== args.length) {
      matchSet.add(OverloadMatch.Mismatch)
      return
    }

    funcType.params.forEach((paramType, index) => {
      const argType = this.typeComputer.inferType(args[index])
      if (!argType) {
        matchSet.add(OverloadMatch.ImplicitCastType)
      }
      else {
        this.matchType(paramType, argType, matchSet)
      }
    })
  }

  private matchType(paramType: Type, argType: Type, matchSet: Set<OverloadMatch>) {
    if (this.typeFeatures.areTypesEqual(paramType, argType)) {
      matchSet.add(OverloadMatch.EqualType)
    }
    else if (this.typeFeatures.isSubType(argType, paramType)) {
      matchSet.add(OverloadMatch.SubType)
    }
    else if (this.typeFeatures.isConvertible(argType, paramType)) {
      matchSet.add(OverloadMatch.ImplicitCastType)
    }
    else {
      matchSet.add(OverloadMatch.Mismatch)
    }
  }
}
