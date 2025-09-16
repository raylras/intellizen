import type { AstNode, AstNodeDescription, LocalSymbols, ReferenceInfo, Scope, Stream } from 'langium'
import type { ZenScriptAstType } from '../generated/ast'
import type { ZenScriptServices } from '../module'
import type { TypeComputer } from '../typing/type-computer'
import type { Type } from '../typing/type-description'
import type { PackageManager } from '../workspace/package-manager'
import type { MemberProvider } from './member-provider'
import { AstUtils, DefaultScopeProvider, EMPTY_SCOPE, EMPTY_STREAM, stream, StreamScope } from 'langium'
import * as ast from '../generated/ast'
import { getSubstType, isArrayType, isClassType, isFunctionType, isListType } from '../typing/type-description'
import { getDirectChildOf } from '../utils/ast'
import { defineRules } from '../utils/rule'
import { createSyntheticAstNodeDescription } from './synthetic'

type RuleSpec = ZenScriptAstType
type RuleMap = { [K in keyof RuleSpec]?: (node: RuleSpec[K], info: ReferenceInfo, provider: ZenScriptScopeProvider) => Generator<AstNodeDescription> }

export class ZenScriptScopeProvider extends DefaultScopeProvider {
  private readonly packageManager: PackageManager
  private readonly memberProvider: MemberProvider
  private readonly typeComputer: TypeComputer

  constructor(services: ZenScriptServices) {
    super(services)
    this.packageManager = services.references.PackageManager
    this.memberProvider = services.references.MemberProvider
    this.typeComputer = services.typing.TypeComputer
  }

  override getScope(info: ReferenceInfo): Scope {
    const symbols = this.getSymbols(info.container, info)
    return symbols ? new StreamScope(stream(symbols)) : EMPTY_SCOPE
  }

  private getSymbols(node: AstNode, info: ReferenceInfo): Iterable<AstNodeDescription> | undefined {
    return this.symbolRules(node.$type)?.call(this, node, info, this)
  }

  private readonly symbolRules = defineRules<RuleMap>({
    * ImportItem(node, info, provider) {
      if (node.previous) {
        yield* provider.getMembers(node.previous)
      }
      else {
        yield* provider.getRootPackages()
      }
    },

    * NamedTypeItem(node, info, provider) {
      if (node.previous) {
        yield* provider.getMembers(node.previous)
      }
      else {
        yield* provider.getOuterSymbols(AstUtils.getContainerOfType(node, ast.isNamedType), info)
        yield* provider.getBuiltinClasses()
        yield* provider.getRootPackages()
      }
    },

    * ReferenceExpression(node, info, provider) {
      yield* provider.getOuterSymbols(node, info)
    },

    * Script(node, info, provider) {
      if (ast.isReferenceExpression(info.container)) {
        const documentSymbols = AstUtils.getDocument(node).localSymbols
        if (documentSymbols) {
          const locals = provider.getLocals(node, node.statements, info)
          const statics = provider.getStatics(node.statements)
          const functions = node.functions.filter(it => it.variance === undefined)
          const classes = node.classes
          const imports = node.imports
          yield* provider.toDescriptions([locals, statics, functions, classes, imports], documentSymbols)
        }
        yield* provider.getGlobals()
        yield* provider.getBuiltinClasses()
        yield* provider.getRootPackages()
      }
      else if (ast.isNamedTypeItem(info.container) && !info.container.previous) {
        const documentSymbols = AstUtils.getDocument(node).localSymbols
        if (documentSymbols) {
          const classes = node.classes
          const imports = node.imports.filter(it => ast.isClassDeclaration(it.item.entity?.ref))
          yield* provider.toDescriptions([classes, imports], documentSymbols)
        }
        yield* provider.getBuiltinClasses()
        yield* provider.getRootPackages()
      }
    },

    * FunctionDeclaration(node, info, provider) {
      if (ast.isReferenceExpression(info.container)) {
        const child = getDirectChildOf(node, info.container)
        if (child.$containerProperty === ast.FunctionDeclaration.body) {
          const documentSymbols = AstUtils.getDocument(node).localSymbols
          if (documentSymbols) {
            const locals = provider.getLocals(node, node.body, info)
            const params = node.params.toReversed()
            const self = node
            yield* provider.toDescriptions([locals, params, self], documentSymbols)
          }
        }
      }
    },

    * ClassDeclaration(node, info, provider) {
      if (ast.isReferenceExpression(info.container)) {
        const syntheticThis = provider.descriptions.createDescription(node, 'this')
        yield syntheticThis

        const documentSymbols = AstUtils.getDocument(node).localSymbols
        if (documentSymbols) {
          const self = node
          const members = node.members
          yield* provider.toDescriptions([self, members], documentSymbols)
        }
      }
      else if (ast.isNamedTypeItem(info.container) && !info.container.previous) {
        const documentSymbols = AstUtils.getDocument(node).localSymbols
        if (documentSymbols) {
          const self = node
          const typeParams = node.typeParams
          yield* provider.toDescriptions([self, typeParams], documentSymbols)
        }
      }
    },

    * ConstructorDeclaration(node, info, provider) {
      if (ast.isReferenceExpression(info.container)) {
        const child = getDirectChildOf(node, info.container)
        if (child.$containerProperty === ast.FunctionDeclaration.body) {
          const documentSymbols = AstUtils.getDocument(node).localSymbols
          if (documentSymbols) {
            const locals = provider.getLocals(node, node.body, info)
            const params = node.params.toReversed()
            yield* provider.toDescriptions([locals, params], documentSymbols)
          }
        }
      }
    },

    * ForStatement(node, info, provider) {
      if (ast.isReferenceExpression(info.container)) {
        const child = getDirectChildOf(node, info.container)
        if (child.$containerProperty === ast.ForStatement.body) {
          const documentSymbols = AstUtils.getDocument(node).localSymbols
          if (documentSymbols) {
            const params = node.params.toReversed()
            yield* provider.toDescriptions(params, documentSymbols)
          }
        }
      }
    },

    * BlockStatement(node, info, provider) {
      if (ast.isReferenceExpression(info.container)) {
        const documentSymbols = AstUtils.getDocument(node).localSymbols
        if (documentSymbols) {
          const locals = provider.getLocals(node, node.body, info)
          yield* provider.toDescriptions(locals, documentSymbols)
        }
      }
    },

    * AccessExpression(node, info, provider) {
      if (node === info.container) {
        const members = provider.memberProvider.streamMembers(node.receiver)
        let overload: ast.OperatorFunctionDeclaration | undefined
        for (const it of members) {
          if (ast.isOperatorFunctionDeclaration(it) && it.operator === '.' && it.params.length === 1) {
            overload = it
            continue
          }
          const desc = provider.tryMapToDescription(it)
          if (desc) {
            yield desc
          }
        }
        if (overload) {
          yield provider.descriptions.createDescription(overload.params[0], info.reference.$refText)
        }
      }
      else if (ast.isReferenceExpression(info.container)) {
        const child = getDirectChildOf(node, info.container)
        if (child.$containerProperty === ast.AccessExpression.args) {
          const type = provider.getParamType(child.$containerIndex!, node.entity?.ref)
          if (type) {
            yield* provider.getTypeStaticSymbols(type)
          }
        }
      }
    },

    * CallExpression(node, info, provider) {
      if (ast.isReferenceExpression(info.container)) {
        const child = getDirectChildOf(node, info.container)
        if (child.$containerProperty === ast.CallExpression.args) {
          const type = provider.getParamType(child.$containerIndex!, node.receiver)
          if (type) {
            yield* provider.getTypeStaticSymbols(type)
          }
        }
      }
    },

    * FunctionExpression(node, info, provider) {
      if (ast.isReferenceExpression(info.container)) {
        const child = getDirectChildOf(node, info.container)
        if (child.$containerProperty === ast.FunctionDeclaration.body) {
          const documentSymbols = AstUtils.getDocument(node).localSymbols
          if (documentSymbols) {
            const locals = provider.getLocals(node, node.body, info)
            const params = node.params.toReversed()
            const self = node
            yield* provider.toDescriptions([locals, params, self], documentSymbols)
          }
        }
      }
    },

    * ArrayLiteral(node, info, provider) {
      let expect: Type | undefined
      if (ast.isTypeCastExpression(node.$container)) {
        expect = provider.typeComputer.inferType(node.$container)
      }
      else {
        expect = undefined
      }

      if (isArrayType(expect) || isListType(expect)) {
        const elementType = getSubstType(expect, 'T')
        if (elementType) {
          yield* provider.getTypeStaticSymbols(elementType)
        }
      }
    },
  })

  private tryMapToDescription(node: AstNode): AstNodeDescription | undefined {
    const name = this.nameProvider.getName(node)
    if (name) {
      return this.descriptions.getOrCreateDescription(node, name)
    }
  }

  private toDescriptions(candidates: (AstNode | AstNode[])[], documentSymbols: LocalSymbols): Stream<AstNodeDescription> {
    return stream(candidates)
      .flat()
      .filter(it => documentSymbols.has(it))
      .flatMap(it => documentSymbols.getStream(it))
  }

  private getRootPackages(): Stream<AstNodeDescription> {
    return stream(this.packageManager.root.children.values())
      .filter(it => !it.hasData())
      .map(it => createSyntheticAstNodeDescription(it.name, it))
  }

  private getBuiltinClasses(): Stream<AstNodeDescription> {
    return stream(this.packageManager.root.children.values())
      .filter(it => it.hasData())
      .flatMap(it => it.data)
      .filter(ast.isClassDeclaration)
      .map(it => this.tryMapToDescription(it))
      .nonNullable()
  }

  private getGlobals(): Stream<AstNodeDescription> {
    return this.indexManager.allElements()
  }

  private getMembers(node: AstNode): Stream<AstNodeDescription> {
    return this.memberProvider.streamMembers(node)
      .map(it => this.tryMapToDescription(it))
      .nonNullable()
  }

  private getLocals(container: AstNode, body: AstNode[], info: ReferenceInfo): ast.VariableDeclaration[] {
    const upperBound = getDirectChildOf(container, info.container).$containerIndex
    return body
      .slice(0, upperBound)
      .filter(ast.isVariableDeclaration)
      .filter(it => it.variance === 'var' || it.variance === 'val')
      .toReversed()
  }

  private getStatics(body: AstNode[]): ast.VariableDeclaration[] {
    return body
      .filter(ast.isVariableDeclaration)
      .filter(it => it.variance === 'static')
  }

  private getOuterSymbols(seed: AstNode | undefined, info: ReferenceInfo): Stream<AstNodeDescription> {
    const deque: Iterable<AstNodeDescription>[] = []
    let level: AstNode | undefined = seed?.$container
    while (level) {
      const symbols = this.getSymbols(level, info)
      if (symbols) {
        deque.push(symbols)
      }
      level = level.$container
    }
    return stream(deque).flat()
  }

  private getParamType(index: number, receiver: AstNode | undefined): Type | undefined {
    const receiverType = this.typeComputer.inferType(receiver)
    if (isFunctionType(receiverType)) {
      return receiverType.params[index]
    }
  }

  private getTypeStaticSymbols(type: Type): Stream<AstNodeDescription> {
    if (isClassType(type) && type.decl) {
      return stream(type.decl.members)
        .filter(ast.isFunctionDeclaration)
        .filter(it => it.variance === 'static')
        .filter(it => it.params.length === 0)
        .map(it => this.descriptions.getOrCreateDescription(it, it.name))
    }
    else {
      return EMPTY_STREAM
    }
  }
}
