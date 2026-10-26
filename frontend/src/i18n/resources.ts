import enAlerts from './en/alerts.json'
import enAuth from './en/auth.json'
import enCommon from './en/common.json'
import enDemo from './en/demo.json'
import enLanding from './en/landing.json'
import enNotFound from './en/notFound.json'
import enPrices from './en/prices.json'
import enShell from './en/shell.json'
import enVerification from './en/verification.json'
import ruAlerts from './ru/alerts.json'
import ruAuth from './ru/auth.json'
import ruCommon from './ru/common.json'
import ruDemo from './ru/demo.json'
import ruLanding from './ru/landing.json'
import ruNotFound from './ru/notFound.json'
import ruPrices from './ru/prices.json'
import ruShell from './ru/shell.json'
import ruVerification from './ru/verification.json'

// One file per feature per locale, merged here into the single namespace: the
// file name becomes the top-level key, so two features cannot collide on one.
// Lazy loading is out of scope for the stage, which removes the only thing
// real namespaces buy and leaves their cost — a namespace in every call.
export const en = {
  alerts: enAlerts,
  auth: enAuth,
  common: enCommon,
  demo: enDemo,
  landing: enLanding,
  notFound: enNotFound,
  prices: enPrices,
  shell: enShell,
  verification: enVerification,
}

// `satisfies` is the compile error the stage asks for: a key paid for in
// English and missing in Russian fails the build right here, rather than
// rendering a raw key at a user. Extra Russian keys pass on purpose — `_few`
// and `_many` have nothing in English to correspond to, which is exactly the
// hole the plural test closes.
export const ru = {
  alerts: ruAlerts,
  auth: ruAuth,
  common: ruCommon,
  demo: ruDemo,
  landing: ruLanding,
  notFound: ruNotFound,
  prices: ruPrices,
  shell: ruShell,
  verification: ruVerification,
} satisfies typeof en

export const resources = {
  en: { translation: en },
  ru: { translation: ru },
}
