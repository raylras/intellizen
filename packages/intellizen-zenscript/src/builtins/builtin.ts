import { URI, UriUtils } from 'langium'

const builtinsDir = __dirname
const builtinsUri = URI.file(builtinsDir)

export function getBuiltinsUri(): URI {
  return builtinsUri
}

export function isBuiltin(uri: URI | string): boolean {
  return UriUtils.contains(builtinsUri, uri)
}
