import type { en } from './resources'

// What makes `t('alerts.card.triggerCount')` a checked call rather than a
// string: i18next reads its key union out of this declaration. Parity between
// the catalogues is the type system's job, not the reviewer's.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof en }
  }
}
