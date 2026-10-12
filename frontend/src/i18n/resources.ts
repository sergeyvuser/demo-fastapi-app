import enCommon from './en/common.json'
import enNotFound from './en/notFound.json'
import ruCommon from './ru/common.json'
import ruNotFound from './ru/notFound.json'

// One file per feature per locale, merged here into the single namespace: the
// file name becomes the top-level key, so two features cannot collide on one.
// Lazy loading is out of scope for the stage, which removes the only thing
// real namespaces buy and leaves their cost — a namespace in every call.
export const en = {
    common: enCommon,
    notFound: enNotFound,
}

// `satisfies` is the compile error the stage asks for: a key paid for in
// English and missing in Russian fails the build right here, rather than
// rendering a raw key at a user. Extra Russian keys pass on purpose — `_few`
// and `_many` have nothing in English to correspond to, which is exactly the
// hole the plural test closes.
export const ru = {
    common: ruCommon,
    notFound: ruNotFound,
} satisfies typeof en

export const resources = {
    en: { translation: en },
    ru: { translation: ru },
}
