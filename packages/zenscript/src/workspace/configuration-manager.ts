import { existsSync, statSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import type { FileSystemProvider, WorkspaceFolder } from 'langium'
import { URI, UriUtils } from 'langium'
import { findInside, isDirectory, isFile } from '../utils/fs'
import type { ZenScriptSharedServices } from '../module'
import type { ParsedConfig } from './configurations'
import { IntelliZenSchema, StringConstants } from './configurations'

declare module 'langium' {
  interface WorkspaceFolder {
    config: ParsedConfig
  }
}

export interface ConfigurationManager {
  initialize: (folders: WorkspaceFolder[]) => Promise<void>
}

export class ZenScriptConfigurationManager implements ConfigurationManager {
  private readonly fileSystemProvider: FileSystemProvider

  constructor(services: ZenScriptSharedServices) {
    this.fileSystemProvider = services.workspace.FileSystemProvider
  }

  async initialize(folders: WorkspaceFolder[]) {
    await Promise.all(folders.map(folder => this.loadConfig(folder)))
  }

  private async loadConfig(workspaceFolder: WorkspaceFolder) {
    const workspaceUri = URI.file(workspaceFolder.uri)
    const configUri = await this.findConfig(workspaceFolder)
    const parsedConfig: ParsedConfig = { srcRoots: [], extra: {} }
    if (configUri) {
      try {
        await this.load(parsedConfig, configUri)
      }
      catch (cause) {
        console.error(new ConfigError(workspaceFolder, { cause }))
      }
    }
    else {
      console.error(new ConfigError(workspaceFolder, { cause: new Error(`Config file "${StringConstants.Config.intellizen}" not found.`) }))
    }
    await this.finalize(parsedConfig, workspaceUri)
    workspaceFolder.config = parsedConfig
  }

  private async load(parsedConfig: ParsedConfig, configUri: URI) {
    const content = await this.fileSystemProvider.readFile(configUri)
    const config = IntelliZenSchema.parse(JSON.parse(content))

    for (const srcRoot of config.srcRoots) {
      const srcRootPath = resolvePath(configUri.fsPath, '..', srcRoot)
      if (existsDirectory(srcRootPath)) {
        parsedConfig.srcRoots.push(URI.file(srcRootPath))
      }
      else {
        console.error(new DirectoryNotFoundError(srcRootPath))
      }
    }

    const brackets = config.extra?.brackets
    if (brackets) {
      const filePath = resolvePath(configUri.fsPath, '..', brackets)
      if (existsFile(filePath)) {
        parsedConfig.extra.brackets = URI.file(filePath)
      }
      else {
        console.error(new EntryError('extra.brackets', { cause: new FileNotFoundError(brackets) }))
      }
    }

    const preprocessors = config.extra?.preprocessors
    if (preprocessors) {
      const filePath = resolvePath(configUri.fsPath, '..', preprocessors)
      if (existsFile(filePath)) {
        parsedConfig.extra.preprocessors = URI.file(filePath)
      }
      else {
        console.error(new EntryError('extra.preprocessors', { cause: new FileNotFoundError(preprocessors) }))
      }
    }
  }

  private async finalize(parsedConfig: ParsedConfig, workspaceUri: URI) {
    if (parsedConfig.srcRoots.length === 0) {
      // Oops, this means something went wrong. Falling back to find the 'scripts' folder.
      if (StringConstants.Folder.scripts === UriUtils.basename(workspaceUri)) {
        parsedConfig.srcRoots = [workspaceUri]
      }
      else {
        const scriptsUri = await findInside(this.fileSystemProvider, workspaceUri, node => isDirectory(node, StringConstants.Folder.scripts))
        if (scriptsUri) {
          parsedConfig.srcRoots = [scriptsUri]
        }
        else {
          // Sad, the 'scripts' folder is not found either, fallback to use the workspace uri.
          parsedConfig.srcRoots = [workspaceUri]
        }
      }
    }
  }

  private async findConfig(workspaceFolder: WorkspaceFolder): Promise<URI | undefined> {
    const workspaceUri = URI.parse(workspaceFolder.uri)
    return findInside(this.fileSystemProvider, workspaceUri, node => isFile(node, StringConstants.Config.intellizen))
  }
}

function existsDirectory(dirPath: string): boolean {
  return existsSync(dirPath) && statSync(dirPath).isDirectory()
}

function existsFile(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isFile()
}

class ConfigError extends Error {
  constructor(workspaceFolder: WorkspaceFolder, options?: ErrorOptions) {
    super(`An error occurred parsing "${StringConstants.Config.intellizen}" located in the workspace folder "${workspaceFolder.name}".`, options)
  }
}

class EntryError extends Error {
  constructor(entry: string, options?: ErrorOptions) {
    super(`An error occurred parsing entry "${entry}".`, options)
  }
}

class FileNotFoundError extends Error {
  constructor(filePath: string, options?: ErrorOptions) {
    super(`File "${filePath}" does not exist.`, options)
  }
}

class DirectoryNotFoundError extends Error {
  constructor(dirPath: string, options?: ErrorOptions) {
    super(`Directory "${dirPath}" does not exist.`, options)
  }
}
