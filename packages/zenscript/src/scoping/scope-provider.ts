import type { AstNodeDescription, ReferenceInfo, Scope } from 'langium'
import { AstUtils, DefaultScopeProvider, EMPTY_SCOPE, URI, stream } from 'langium'
import type { ClassTypeReference, ImportDeclaration, MemberAccess, ZenScriptAstType } from '../generated/ast'
import { ClassDeclaration, isClassDeclaration, isScript } from '../generated/ast'
import type { ZenScriptServices } from '../module'
import { getPathAsString } from '../utils/ast'
import type { PackageManager } from '../workspace/package-manager'
import type { MemberProvider } from './member-provider'

type SourceKey = keyof ZenScriptAstType
type Produce = (source: ReferenceInfo) => Scope
type Rule = <K extends SourceKey>(match: K, produce: Produce) => void
type RuleMap = Map<SourceKey, Produce>

const builtin: AstNodeDescription[] = ['any', 'byte', 'short', 'int', 'long', 'float', 'double', 'bool', 'void', 'string']
  .map(name => ({
    type: ClassDeclaration,
    name,
    documentUri: URI.from({ scheme: 'intellizen', path: `/builtin/${name}` }),
    path: '',
  }))

export class ZenScriptScopeProvider extends DefaultScopeProvider {
  private readonly packageManager: PackageManager
  private readonly memberProvider: MemberProvider
  private readonly rules: RuleMap

  override getScope(context: ReferenceInfo): Scope {
    const match = context.container.$type as SourceKey
    const produce = this.rules.get(match)
    return produce ? produce(context) : super.getScope(context)
  }

  constructor(services: ZenScriptServices) {
    super(services)
    this.packageManager = services.workspace.PackageManager
    this.memberProvider = services.references.MemberProvider
    this.rules = this.initRules()
  }

  private initRules(): RuleMap {
    const rules: RuleMap = new Map()
    const rule: Rule = (match, produce) => {
      if (rules.has(match)) {
        throw new Error(`Rule "${match}" is already defined.`)
      }
      rules.set(match, produce)
    }

    rule('ImportDeclaration', (source) => {
      const importDecl = source.container as ImportDeclaration
      const path = getPathAsString(importDecl, source)
      const siblings = this.packageManager.getHierarchyNode(path)?.children.values()
      if (!siblings) {
        return EMPTY_SCOPE
      }

      const elements: AstNodeDescription[] = []
      for (const sibling of siblings) {
        if (sibling.value) {
          elements.push(this.descriptions.createDescription(sibling.value, sibling.name))
        }
        else {
          // TODO: temporary, needs to be reimplemented
          elements.push({
            type: 'package',
            name: sibling.name,
            documentUri: URI.file('file:///path/to/package'),
            path: '',
          })
        }
      }

      return this.createScope(elements)
    })

    rule('ReferenceExpression', (source) => {
      return super.getScope(source)
    })

    rule('MemberAccess', (source) => {
      const container = source.container as MemberAccess
      const members = this.memberProvider.getMember(container.receiver)
      return this.createScope(members)
    })

    rule('ClassTypeReference', (source) => {
      const container = source.container as ClassTypeReference
      if (source.index === 0) {
        const script = AstUtils.getContainerOfType(container, isScript)
        if (!script) {
          return EMPTY_SCOPE
        }

        const globals = stream(this.packageManager.getHierarchyNode('')!.children.values())
          .map(it => it.value)
          .filter(it => isClassDeclaration(it))
          .map(it => this.descriptions.createDescription(it, it.name))

        const imports = script.imports
          .map((it) => {
            const desc = it.path.at(-1)?.$nodeDescription ?? this.descriptions.createDescription(it, undefined)
            desc.name = this.nameProvider.getName(it) ?? desc.name
            return desc
          })
          .filter(it => !!it)

        const locals = script.classes
          .map(it => this.descriptions.createDescription(it, it.name))

        let scope = this.createScope(builtin)
        scope = this.createScope(globals, scope)
        scope = this.createScope(imports, scope)
        scope = this.createScope(locals, scope)
        return scope
      }
      else if (source.index !== undefined) {
        const prev = container.path[source.index - 1].ref
        const members = this.memberProvider.getMember(prev)
        return this.createScope(members)
      }
      else {
        return EMPTY_SCOPE
      }
    })

    return rules
  }
}
