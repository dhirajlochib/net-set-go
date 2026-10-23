import type { NetSetGoApi } from './index'

declare global {
  interface Window {
    netsetgo: NetSetGoApi
  }
}
