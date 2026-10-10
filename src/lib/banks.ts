/** Instituciones bancarias incluidas en el directorio bancario publicado por SUDEBAN. */
export const venezuelanBanks = [
  { name: '100% Banco', aliases: ['100% banco', '100 banco'] },
  { name: 'Bancamiga', aliases: ['bancamiga'] },
  { name: 'Banco Activo', aliases: ['banco activo', 'activo'] },
  { name: 'Banco Agrícola de Venezuela', aliases: ['banco agricola', 'agricola de venezuela'] },
  { name: 'Banco Digital de los Trabajadores (BDT)', aliases: ['banco digital de los trabajadores', 'bdt', 'bicentenario'] },
  { name: 'Banco Caroní', aliases: ['banco caroni', 'caroni'] },
  { name: 'Banco de Comercio Exterior (BANCOEX)', aliases: ['bancoex', 'banco de comercio exterior'] },
  { name: 'Banco de Desarrollo Económico y Social (BANDES)', aliases: ['bandes', 'banco de desarrollo economico'] },
  { name: 'Banco de la Fuerza Armada (BANFANB)', aliases: ['banfanb', 'fuerza armada'] },
  { name: 'Banco de la Gente Emprendedora (BANGENTE)', aliases: ['bangente'] },
  { name: 'Banco de Venezuela', aliases: ['banco de venezuela', 'venezuela'] },
  { name: 'Bancaribe', aliases: ['bancaribe', 'banco del caribe'] },
  { name: 'Banco del Tesoro', aliases: ['banco del tesoro', 'tesoro'] },
  { name: 'Banco Exterior', aliases: ['banco exterior', 'exterior'] },
  { name: 'Banco Internacional de Desarrollo (BID)', aliases: ['banco internacional de desarrollo'] },
  { name: 'Banco Nacional de Crédito (BNC)', aliases: ['banco nacional de credito', 'bnc'] },
  { name: 'Banco Plaza', aliases: ['banco plaza'] },
  { name: 'Banco Provincial', aliases: ['banco provincial', 'provincial'] },
  { name: 'Banco Sofitasa', aliases: ['banco sofitasa', 'sofitasa'] },
  { name: 'Bancrecer', aliases: ['bancrecer'] },
  { name: 'Banesco', aliases: ['banesco'] },
  { name: 'Banplus', aliases: ['banplus'] },
  { name: 'BFC Banco Fondo Común', aliases: ['bfc', 'fondo comun'] },
  { name: 'DelSur Banco Universal', aliases: ['delsur', 'del sur'] },
  { name: 'Mercantil', aliases: ['mercantil'] },
  { name: 'R4 Banco Microfinanciero', aliases: ['r4 banco', 'r4 microfinanciero'] },
  { name: 'Venezolano de Crédito', aliases: ['venezolano de credito'] },
  { name: 'N58 Banco Digital', aliases: ['n58'] },
] as const

function normalized(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim()
}

export function detectVenezuelanBank(text: string): string {
  const source = ` ${normalized(text)} `
  const detected = venezuelanBanks.find(({ aliases }) => aliases.some((alias) => source.includes(` ${normalized(alias)} `)))
  return detected?.name ?? ''
}
