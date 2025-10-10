import { URI } from 'langium'
import _any from './any.dzs'
import _Array from './Array.dzs'
import _bool from './bool.dzs'
import _byte from './byte.dzs'
import _double from './double.dzs'
import _Entry from './Entry.dzs'
import _float from './float.dzs'
import _int from './int.dzs'
import _IntRange from './IntRage.dzs'
import _List from './List.dzs'
import _long from './long.dzs'
import _Map from './Map.dzs'
import _short from './short.dzs'
import _string from './string.dzs'
import _void from './void.dzs'

export const builtinsFileMap = createBuiltinsFileMap()

function createBuiltinsFileMap(): Map<string, string> {
  return new Map([
    ['any.dzs', _any],
    ['Array.dzs', _Array],
    ['bool.dzs', _bool],
    ['byte.dzs', _byte],
    ['double.dzs', _double],
    ['Entry.dzs', _Entry],
    ['float.dzs', _float],
    ['int.dzs', _int],
    ['IntRange.dzs', _IntRange],
    ['List.dzs', _List],
    ['long.dzs', _long],
    ['Map.dzs', _Map],
    ['short.dzs', _short],
    ['string.dzs', _string],
    ['void.dzs', _void],
  ])
}

export const builtinsUriMap = createBuiltinsUriMap()

function createBuiltinsUriMap(): Map<URI, string> {
  return new Map(builtinsFileMap.entries().map(([filename, content]) => [URI.from({ scheme: 'builtin', path: `/${filename}` }), content]))
}

export function isBuiltin(uri: URI | string): boolean {
  return URI.parse(uri.toString()).scheme === 'builtin'
}
