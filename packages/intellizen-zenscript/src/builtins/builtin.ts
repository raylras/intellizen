import { URI } from 'langium'

import anyDzs from './any.dzs'
import arrayDzs from './Array.dzs'
import boolDzs from './bool.dzs'
import byteDzs from './byte.dzs'
import doubleDzs from './double.dzs'
import entryDzs from './Entry.dzs'
import floatDzs from './float.dzs'
import intDzs from './int.dzs'
import intRangeDzs from './IntRage.dzs'
import listDzs from './List.dzs'
import longDzs from './long.dzs'
import mapDzs from './Map.dzs'
import shortDzs from './short.dzs'
import stringDzs from './string.dzs'
import voidDzs from './void.dzs'

export interface Builtin {
  uri: URI
  content: string
}

const builtins = [
  { name: 'any.dzs', content: anyDzs },
  { name: 'Array.dzs', content: arrayDzs },
  { name: 'bool.dzs', content: boolDzs },
  { name: 'byte.dzs', content: byteDzs },
  { name: 'double.dzs', content: doubleDzs },
  { name: 'Entry.dzs', content: entryDzs },
  { name: 'float.dzs', content: floatDzs },
  { name: 'int.dzs', content: intDzs },
  { name: 'IntRange.dzs', content: intRangeDzs },
  { name: 'List.dzs', content: listDzs },
  { name: 'long.dzs', content: longDzs },
  { name: 'Map.dzs', content: mapDzs },
  { name: 'short.dzs', content: shortDzs },
  { name: 'string.dzs', content: stringDzs },
  { name: 'void.dzs', content: voidDzs },
]

// const builtinsDir = __dirname
// const builtinsUri = URI.file(builtinsDir)

// export function getBuiltinsUri(): URI {
//   return builtinsUri
// }

export function isBuiltin(uri: URI | string): boolean {
  const uriObj = typeof uri === 'string' ? URI.parse(uri) : uri
  // "builtin://" is the scheme used by langium for built-in resources
  return uriObj.scheme === 'builtin'
}

export function getBuiltins(): Builtin[] {
  return builtins.map(builtin => ({
    uri: URI.parse(`builtin:///builtin/${builtin.name}`),
    content: builtin.content,
  }))
}
