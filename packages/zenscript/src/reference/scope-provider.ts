import type { AstNode, AstNodeDescription, ReferenceInfo as ReferenceInfoLangium, Scope, ScopeOptions, Stream } from 'langium'
import type { ZenScriptAstType } from '../generated/ast'
import type { ZenScriptServices } from '../module'
import type { TypeComputer } from '../typing/type-computer'
import type { PackageManager } from '../workspace/package-manager'
import type { MemberProvider } from './member-provider'
import { AstUtils, DefaultScopeProvider, EMPTY_SCOPE, EMPTY_STREAM, stream, StreamScope } from 'langium'
import * as ast from '../generated/ast'
import { isClassType, isFunctionType } from '../typing/type-description'
import { binarySearchUpperBound, isStatic } from '../utils/ast'
import { defineRules } from '../utils/rule'
import { generateStream, toStream } from '../utils/stream'
import { createSyntheticAstNode, createSyntheticAstNodeDescription } from './synthetic'

type RuleSpec = ZenScriptAstType
type RuleMap = { [K in keyof RuleSpec]?: (info: ReferenceInfo<K>) => Scope }
type ReferenceInfo<K extends keyof RuleSpec = any> = Omit<ReferenceInfoLangium, 'container'> & { container: RuleSpec[K] }

declare module 'langium' {
  interface LocalSymbols {
    get: (key: AstNode) => AstNodeDescription[]
  }
}

interface LexicalNode {
  container: AstNode
  symbols: AstNodeDescription[]
}

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

  override getScope(context: ReferenceInfo): Scope {
    return this.scopeRules(context.container.$type)?.call(this, context) ?? EMPTY_SCOPE
  }

  private readonly scopeRules = defineRules<RuleMap>({
    ImportItem: ({ container }) => {
      if (container.previous) {
        const elements = this.memberProvider.streamMembers(container.previous)
        return this.createScopeForNodes(elements)
      }
      else {
        const children = this.packageManager.root.children.values().map(createSyntheticAstNode)
        return this.createScopeForNodes(children)
      }
    },

    ReferenceExpression: ({ container }) => {
      let scope: Scope
      scope = this.createPackageNameScope()
      scope = this.createGlobalScope(scope)
      scope = this.createDynamicScope(container, scope)

      {
        let seed: AstNode = container.$container
        if (ast.isForStatement(seed) && container.$containerProperty === ast.ForStatement.range) {
          // ForStatement::range should not be accessible to ForStatement::params
          // Skip ForStatement
          seed = seed.$container
        }
        else if (ast.isValueParameter(seed) && container.$containerProperty === ast.ValueParameter.defaultValue) {
          // ValueParameter::defaultValue should not be accessible to ValueParameter itself
          // Skip CallableDeclaration
          seed = seed.$container.$container
        }
        scope = this.streamLexicalSymbols(seed)
          .map((node) => {
            const offset = container.$cstNode!.offset
            // Ensure the ref's offset is greater than the symbol's offset (declaration before usage)
            const upperBound = binarySearchUpperBound(node.symbols, offset, it => it.node!.$cstNode!.offset)
            // Reversed order (nearest first)
            return stream(node.symbols.slice(0, upperBound).reverse())
          })
          .reduceRight((outer, symbols) => new StreamScope(symbols, outer), scope)
      }

      return scope
    },

    AccessExpression: ({ container }) => {
      const elements = this.memberProvider.streamMembers(container.receiver)
      const outer = this.createDynamicScope(container)
      return this.createScopeForNodes(elements, outer)
    },

    NamedTypeItem: ({ container }) => {
      const previous = container.previous?.entity.ref
      if (previous) {
        const elements = this.memberProvider.streamMembers(previous)
        return this.createScopeForNodes(elements)
      }
      else {
        let scope: Scope
        scope = this.createPackageNameScope()
        scope = this.createClassNameScope(scope)
        scope = this.streamLexicalSymbols(container)
          .map(node => stream(node.symbols)
            .filter(symbol =>
              ast.isClassDeclaration(symbol.node)
              || ast.isTypeParameter(symbol.node)
              || ast.isImportDeclaration(symbol.node)))
          .reduceRight((outer, symbols) => new StreamScope(symbols, outer), scope)
        return scope
      }
    },
  })

  private streamLexicalSymbols(seed: AstNode): Stream<LexicalNode> {
    const localSymbols = AstUtils.getDocument(seed).localSymbols
    if (localSymbols) {
      return generateStream(seed, it => it.$container)
        .filter(it => localSymbols.has(it))
        .map(it => ({ container: it, symbols: localSymbols.get(it) }))
    }
    else {
      return EMPTY_STREAM
    }
  }

  private createDynamicScope(node: AstNode, outer?: Scope): Scope {
    if (ast.isReferenceExpression(node)) {
      return new StreamScope(toStream(function* (this: ZenScriptScopeProvider) {
        // dynamic this
        const classDecl = AstUtils.getContainerOfType(node, ast.isClassDeclaration)
        if (classDecl) {
          yield this.descriptions.createDescription(classDecl, 'this')
        }

        // dynamic arguments
        if (ast.isCallExpression(node.$container) && node.$containerProperty === ast.CallExpression.args) {
          const index = node.$containerIndex!
          const receiverType = this.typeComputer.inferType(node.$container.receiver)
          if (isFunctionType(receiverType)) {
            const paramType = receiverType.params[index]
            if (isClassType(paramType) && paramType.decl) {
              yield* stream(paramType.decl.members)
                .filter(ast.isFunctionDeclaration)
                .filter(isStatic)
                .filter(it => it.params.length === 0)
                .map(it => this.descriptions.getOrCreateDescription(it))
            }
          }
        }
      }.bind(this)), outer)
    }
    else if (ast.isAccessExpression(node)) {
      return new StreamScope(toStream(function* (this: ZenScriptScopeProvider) {
        // dynamic members
        const receiverType = this.typeComputer.inferType(node.receiver)
        if (isClassType(receiverType) && receiverType.decl) {
          const operatorDecl = stream(receiverType.decl.members)
            .filter(ast.isOperatorFunctionDeclaration)
            .filter(it => it.operator === '.')
            .filter(it => it.params.length === 1)
            .head()
          if (operatorDecl) {
            yield this.descriptions.createDescription(operatorDecl.params[0], node.entity.$refText)
          }
        }
      }.bind(this)), outer)
    }
    else {
      return EMPTY_SCOPE
    }
  }

  private createGlobalScope(outer?: Scope): Scope {
    return new StreamScope(this.indexManager.allElements(), outer)
  }

  private createPackageNameScope(outer?: Scope): Scope {
    const packages = stream(this.packageManager.root.children.values())
      .filter(it => !it.hasData())
      .map(it => createSyntheticAstNodeDescription(it.name, it))
    return new StreamScope(packages, outer)
  }

  private createClassNameScope(outer?: Scope) {
    const classes = stream(this.packageManager.root.children.values())
      .filter(it => it.hasData())
      .flatMap(it => it.data)
      .filter(ast.isClassDeclaration)
    return this.createScopeForNodes(classes, outer)
  }

  override createScopeForNodes(nodes: Iterable<AstNode>, outerScope?: Scope, options?: ScopeOptions): Scope {
    return new StreamScope(stream(nodes).map(it => this.descriptions.getOrCreateDescription(it)), outerScope, options)
  }
}
