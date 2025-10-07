import type { FileSystemProvider, WorkspaceFolder } from 'langium'
import type { Connection } from 'vscode-languageserver'
import type { ZenScriptSharedServices } from '../module'
import * as jsonRef from 'jsonref'
import { URI, UriUtils } from 'langium'
import { z } from 'zod'
import { existsDirectory, findInside, isDirectory, isFile } from '../utils/fs'

declare module 'langium' {
  interface WorkspaceFolder {
    config: WorkspaceConfig
  }
}

export interface WorkspaceConfig {
  srcRoots: URI[]
  extra: {
    brackets?: URI
    preprocessors?: URI
  }
}

export const StringConstants = Object.freeze({
  scripts: 'scripts',
  intellizen: 'intellizen.json',
  brackets: 'brackets.json',
  preprocessors: 'preprocessors.json',
})

export const IntelliZenJsonSchema = z.object({
  srcRoots: z.string().array(),
})

export interface ConfigurationManager {
  initialize: (folders: WorkspaceFolder[]) => Promise<void>
  onLoaded: (listener: LoadedListener) => void
}

export type LoadedListener = (folders: WorkspaceFolder[]) => Promise<void>

export class ConfigError extends Error {
  constructor(workspaceFolder: WorkspaceFolder, options?: ErrorOptions) {
    super(`An error occurred parsing "${StringConstants.intellizen}" located in the workspace folder "${workspaceFolder.name}".`, options)
  }
}

export class ZenScriptConfigurationManager implements ConfigurationManager {
  private readonly fsProvider: FileSystemProvider
  private readonly connection: Connection | undefined
  private readonly loadedListeners: LoadedListener[]

  constructor(services: ZenScriptSharedServices) {
    this.fsProvider = services.workspace.FileSystemProvider
    this.connection = services.lsp.Connection
    this.loadedListeners = []
  }

  async initialize(folders: WorkspaceFolder[]) {
    await Promise.all(folders.map(folder => this.loadConfig(folder)))
    await Promise.all(this.loadedListeners.map(listener => listener(folders)))
  }

  onLoaded(listener: LoadedListener) {
    this.loadedListeners.push(listener)
  }

  private async loadConfig(folder: WorkspaceFolder) {
    const folderUri = URI.parse(folder.uri)
    const configUri = await this.findConfig(folder)
    const config: WorkspaceConfig = { srcRoots: [], extra: {} }
    if (configUri) {
      try {
        await this.load(config, configUri)
      }
      catch (cause) {
        console.error(new ConfigError(folder, { cause }))
      }
    }
    else {
      console.error(new ConfigError(folder, { cause: new Error(`Config file "${StringConstants.intellizen}" not found.`) }))
    }
    await this.makeSureSrcRootsIsNotEmpty(config, folderUri)
    folder.config = config
  }

  private async load(config: WorkspaceConfig, configUri: URI) {
    const content = await this.fsProvider.readFile(configUri)
    const json = JSON.parse(content)
    const resolved = await jsonRef.parse(json, { scope: 'http://example.com' })
    const schema = IntelliZenJsonSchema.parse(resolved)

    for (const srcRoot of schema.srcRoots) {
      const srcRootUri = UriUtils.resolvePath(configUri, '..', srcRoot)
      if (await existsDirectory(this.fsProvider, srcRootUri)) {
        config.srcRoots.push(srcRootUri)
      }
      else {
        const message = `Src root uri "${srcRoot}" does not exist.`
        this.connection?.window.showErrorMessage(message, {
          title: 'Open intellizen.json',
          // FIXME: apply command action here
          command: 'workbench.action.files.openFile',
          arguments: [configUri.toString()],
        })
        console.error(`[Error][Workspace/Startup] ${message}`)
      }
    }

    await this.processExtraFile(config)
  }

  private async processExtraFile(config: WorkspaceConfig) {
    const nodes = (await Promise.all(config.srcRoots.map(srcRoot => this.fsProvider.readDirectory(srcRoot)))).flat()
    config.extra.brackets = nodes.find(it => isFile(it, StringConstants.brackets))?.uri
    config.extra.preprocessors = nodes.find(it => isFile(it, StringConstants.preprocessors))?.uri
  }

  private async makeSureSrcRootsIsNotEmpty(config: WorkspaceConfig, workspaceUri: URI) {
    if (config.srcRoots.length > 0) {
      return
    }

    if (StringConstants.scripts === UriUtils.basename(workspaceUri)) {
      config.srcRoots = [workspaceUri]
      return
    }

    const scriptsUri = await findInside(this.fsProvider, workspaceUri, node => isDirectory(node, StringConstants.scripts))
    if (scriptsUri) {
      config.srcRoots = [scriptsUri]
      return
    }

    config.srcRoots = [workspaceUri]
  }

  private async findConfig(folder: WorkspaceFolder): Promise<URI | undefined> {
    const folderUri = URI.parse(folder.uri)
    return findInside(this.fsProvider, folderUri, node => isFile(node, StringConstants.intellizen))
  }
}
