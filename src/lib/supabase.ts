import { createClient } from '@supabase/supabase-js'

// Defaults to the MicroFacturas project so a fresh clone/build also connects.
// Both values are browser-public credentials; access is restricted by Supabase Auth and RLS.
const projectDefaults = {
  url: 'https://rnyfgyrwkbkatonxaiug.supabase.co',
  publishableKey: 'sb_publishable_bdffMdrCQMs88mcVR60htg_LAt4khYn',
}

const configuredUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const configuredKey = (
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)
  || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
)?.trim()
const url = configuredUrl && !configuredUrl.includes('TU-PROYECTO') ? configuredUrl : projectDefaults.url
const publishableKey = configuredKey && !configuredKey.includes('TU_CLAVE_PUBLICA') ? configuredKey : projectDefaults.publishableKey

export const supabase = createClient(url, publishableKey)
