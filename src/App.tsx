import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Camera, Check, Cloud, FileCheck2, FileSpreadsheet, ImagePlus, LoaderCircle, LogIn, LogOut, Plus, ReceiptText, Search, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react'
import * as XLSX from 'xlsx'
import type { Receipt, ReceiptDraft } from './types'
import { deleteLocalReceipt, getLocalReceipts, saveLocalReceipt } from './lib/storage'
import { readReceipt } from './lib/ocr'
import { venezuelanBanks } from './lib/banks'
import { supabase } from './lib/supabase'

const emptyDraft: ReceiptDraft = { date: '', receiptNumber: '', location: '', amount: 0, bank: '', image: '' }
const money = new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'VES', minimumFractionDigits: 2 })

export default function App() {
  const [records, setRecords] = useState<Receipt[]>([])
  const [draft, setDraft] = useState<ReceiptDraft>(emptyDraft)
  const [modal, setModal] = useState(false)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ kind: 'cloud' | 'local' | 'error'; detail?: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void getLocalReceipts().then((items) => setRecords(items.filter((item) => !item.synced))).catch(() => setMessage('No se pudo abrir el almacenamiento local de este navegador.'))
    const client = supabase
    if (!client) return
    const hydrate = async (userId: string) => {
      const { data, error } = await client.from('receipts').select('*').eq('user_id', userId).order('created_at', { ascending: false })
      if (error) { setMessage(`No se pudieron cargar los comprobantes de la nube: ${error.message}`); return }
      const local = await getLocalReceipts()
      const localById = new Map(local.map((receipt) => [receipt.id, receipt]))
      const cloud: Receipt[] = (data ?? []).map((row) => ({
        id: row.id, date: row.date, receiptNumber: row.receipt_number, location: row.location,
        amount: Number(row.amount), bank: row.bank, image: localById.get(row.id)?.image ?? '',
        createdAt: row.created_at, ownerId: row.user_id, synced: true,
      }))
      const cloudIds = new Set(cloud.map((receipt) => receipt.id))
      const merged = [...cloud, ...local.filter((receipt) => !receipt.synced && !cloudIds.has(receipt.id))]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      setRecords(merged)
      for (const receipt of cloud) {
        const existing = localById.get(receipt.id)
        if (!existing || !existing.image) await saveLocalReceipt(receipt)
      }
    }
    void client.auth.getSession().then(({ data }) => {
      const sessionUser = data.session?.user
      setUser(sessionUser ? { id: sessionUser.id, email: sessionUser.email } : null)
      if (sessionUser) void hydrate(sessionUser.id)
    })
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user
      setUser(sessionUser ? { id: sessionUser.id, email: sessionUser.email } : null)
      if (sessionUser) void hydrate(sessionUser.id)
      else void getLocalReceipts().then((items) => setRecords(items.filter((item) => !item.synced)))
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const filtered = useMemo(() => records.filter((item) => `${item.receiptNumber} ${item.location} ${item.bank} ${item.date}`.toLowerCase().includes(query.toLowerCase())), [records, query])
  const total = records.reduce((sum, item) => sum + item.amount, 0)

  async function chooseImage(file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/')) { setMessage('Selecciona una imagen de comprobante.'); return }
    const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file) })
    const today = new Date()
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    setDraft({ ...emptyDraft, date: localToday, image })
    setModal(true)
    setOcrBusy(true); setProgress(0); setMessage('')
    try {
      const result = await readReceipt(image, setProgress)
      setDraft((previous) => ({ ...previous, ...result, date: result.date || previous.date }))
      const detected = [result.date, result.receiptNumber, result.location, result.amount !== undefined, result.bank].filter(Boolean).length
      setMessage(detected ? `Se detectaron ${detected} de 5 campos. Revisa y completa los que falten.` : 'No se pudieron distinguir los datos con claridad. Prueba una foto más cercana, enfocada y con el comprobante recto.')
    } catch {
      setMessage('No se pudo leer automáticamente. Puedes completar los datos manualmente.')
    } finally { setOcrBusy(false) }
  }

  async function saveReceipt(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    if (!draft.image) { setMessage('Agrega primero la foto del comprobante.'); return }
    const receipt: Receipt = { ...draft, id: crypto.randomUUID(), createdAt: new Date().toISOString(), ownerId: user?.id ?? null, synced: false }
    let localSaved = false
    setSaving(true)
    try {
      await saveLocalReceipt(receipt)
      localSaved = true
      if (supabase && user) {
        const imageBlob = await (await fetch(draft.image)).blob()
        const extension = imageBlob.type === 'image/png' ? 'png' : imageBlob.type === 'image/webp' ? 'webp' : 'jpg'
        const imagePath = `${user.id}/${receipt.id}.${extension}`
        const { error: uploadError } = await supabase.storage.from('comprobantes').upload(imagePath, imageBlob, { contentType: imageBlob.type || 'image/jpeg', upsert: true })
        if (uploadError) throw uploadError
        const { error: insertError } = await supabase.from('receipts').insert({ id: receipt.id, user_id: user.id, date: receipt.date, receipt_number: receipt.receiptNumber, location: receipt.location, amount: receipt.amount, bank: receipt.bank, image_path: imagePath, created_at: receipt.createdAt })
        if (insertError) throw insertError
        receipt.synced = true
        await saveLocalReceipt(receipt)
      }
      setRecords(await getLocalReceipts()); setModal(false); setDraft(emptyDraft)
      setSaveResult(supabase && user ? { kind: 'cloud' } : { kind: 'local' })
    } catch (error) {
      if (localSaved) setRecords(await getLocalReceipts())
      const raw = error instanceof Error ? error.message : 'error de conexión'
      const detail = /bucket.*not found/i.test(raw)
        ? 'No existe el bucket de imágenes. Ejecuta supabase/schema.sql en el SQL Editor.'
        : /row.level security|permission|42501|unauthorized/i.test(raw)
          ? 'Supabase rechazó el acceso. Revisa que la sesión esté iniciada y que las políticas RLS del esquema estén aplicadas.'
          : /pgrst205|schema cache|relation .* does not exist|table .* not found/i.test(raw)
            ? 'No se encontró la tabla receipts. Ejecuta supabase/schema.sql en el SQL Editor.'
            : raw
      setModal(false)
      setSaveResult(localSaved ? { kind: 'local', detail: `No se completó la copia en la nube: ${detail}` } : { kind: 'error', detail })
    } finally {
      setSaving(false)
    }
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault(); if (!supabase) return
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setMessage(`No se pudo iniciar sesión: ${error.message}`); else { setAuthOpen(false); setMessage('Sesión iniciada.') }
  }

  async function signUp() {
    if (!supabase) return
    setBusy(true); const { error } = await supabase.auth.signUp({ email, password }); setBusy(false)
    setMessage(error ? `No se pudo crear la cuenta: ${error.message}` : 'Cuenta creada. Revisa tu correo para confirmar el registro.')
  }

  async function signOut() { await supabase?.auth.signOut(); setMessage('Sesión cerrada.') }

  function exportExcel() {
    const rows = records.map(({ date, receiptNumber, location, amount }) => ({ Fecha: date, 'Número de comprobante': receiptNumber, Local: location, Monto: amount }))
    const sheet = XLSX.utils.json_to_sheet(rows, { header: ['Fecha', 'Número de comprobante', 'Local', 'Monto'] })
    sheet['!cols'] = [{ wch: 14 }, { wch: 25 }, { wch: 28 }, { wch: 18 }]
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Comprobantes'); XLSX.writeFile(book, `comprobantes-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  async function removeReceipt(receipt: Receipt) {
    await deleteLocalReceipt(receipt.id)
    if (supabase && user && receipt.synced) await supabase.from('receipts').delete().eq('id', receipt.id)
    setRecords(await getLocalReceipts()); setMessage('Comprobante eliminado.')
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><FileCheck2 size={23} strokeWidth={2.1} /><span className="brand-mark-accent" /></div><div><b>MicroFacturas</b><small>Control de comprobantes</small></div></div>
      <div className="side-label">ESPACIO DE TRABAJO</div><div className="nav-item active"><span className="nav-dot" />Comprobantes <span className="nav-count">{records.length}</span></div>
      <div className="sidebar-bottom"><div className="storage-card"><div className="storage-icon"><ShieldCheck size={18} /></div><b>{supabase ? (user ? 'Cuenta conectada' : 'Modo local') : 'Modo local'}</b><p>{supabase ? (user ? user.email : 'Inicia sesión para respaldar en la nube') : 'Tus imágenes y datos se guardan en este dispositivo.'}</p>{supabase && (user ? <button className="text-button" onClick={() => void signOut()}><LogOut size={14} /> Cerrar sesión</button> : <button className="text-button" onClick={() => setAuthOpen(true)}><LogIn size={14} /> Iniciar sesión</button>)}</div><div className="user-chip"><div className="avatar">{user?.email?.[0]?.toUpperCase() ?? 'L'}</div><div><b>{user?.email ?? 'Usuario local'}</b><small>{user ? 'Sesión en la nube' : 'Solo en este dispositivo'}</small></div></div></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="breadcrumb">Espacio de trabajo <span>/</span> <b>Comprobantes</b></div><div className="top-actions">{supabase && !user && <button className="button secondary small" aria-label="Conectar a la nube" onClick={() => setAuthOpen(true)}><Cloud size={16} /> Conectar nube</button>}<button className="button primary small" onClick={() => fileInput.current?.click()}><Plus size={17} /> Nuevo comprobante</button></div></header>
      <section className="page">
        <div className="page-heading"><div><div className="eyebrow">REGISTRO DE PAGOS</div><h1>Comprobantes</h1><p className="subheading">Digitaliza, revisa y organiza los pagos de tus puntos de venta.</p></div><button className="button outline" onClick={exportExcel} disabled={!records.length}><ArrowDownToLine size={17} /> Exportar Excel</button></div>
      <section className="app-banner" aria-label="Resumen de MicroFacturas"><div className="banner-icon animated-receipt"><ReceiptText size={27} strokeWidth={1.8} /><span className="receipt-coin">Bs</span></div><div className="banner-copy"><div className="banner-eyebrow">GESTIÓN DE PUNTOS DE VENTA</div><h2>Facturación organizada, sin complicaciones</h2><p>Registra comprobantes desde el teléfono o la computadora. Revisa cada dato y guarda tu información.</p></div><div className={`banner-sync ${user ? 'connected' : ''}`}><div className="banner-sync-icon"><Cloud size={17} /></div><div><b>{user ? 'Respaldo en la nube activo' : 'Guardado local activo'}</b><small>{user ? user.email : supabase ? 'Inicia sesión para respaldo en la nube' : 'En este navegador; también funciona en PC'}</small></div>{supabase && !user && <button className="banner-connect" onClick={() => setAuthOpen(true)}>Conectar</button>}</div></section>
        {message && <div className={`notice ${/guardado|sesión iniciada/i.test(message) ? 'success' : /no se pudo|no se completó|no se pudieron/i.test(message) ? 'error' : ''}`} role="status"><span>{message}</span><button aria-label="Cerrar aviso" onClick={() => setMessage('')}><X size={15} /></button></div>}
        <div className="stats-row"><div className="stat-card"><span className="stat-icon blue"><FileSpreadsheet size={19} /></span><div><small>Comprobantes registrados</small><b>{records.length}</b></div><span className="stat-foot">En este dispositivo</span></div><div className="stat-card"><span className="stat-icon green"><span className="bolivar">Bs</span></span><div><small>Monto acumulado</small><b>{money.format(total)}</b></div><span className="stat-foot">Total registrado</span></div><div className="stat-card cloud-stat"><span className="stat-icon violet"><Cloud size={19} /></span><div><small>Respaldo en la nube</small><b>{user ? 'Conectado' : 'Desconectado'}</b></div><span className="stat-foot">{user ? 'Sincroniza al guardar' : 'Inicia sesión para activar'}</span></div></div>
        <section className="records-panel"><div className="panel-heading"><div><h2>Todos los comprobantes</h2><p>Consulta los pagos registrados recientemente.</p></div><label className="search-box"><Search size={16} /><input placeholder="Buscar por número, local..." value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
          {!records.length ? <div className="empty-state"><div className="welcome-kicker"><span className="welcome-dot" /> EMPIEZA EN UN MOMENTO</div><div className="empty-art"><div className="paper"><span /><span /><span /><i>Bs</i></div><span className="sparkle one">✦</span><span className="sparkle two">✦</span></div><h3>Registra tu primer comprobante</h3><p>Fotografía o selecciona el recibo del punto de venta. Revisarás los datos antes de guardarlos.</p><button className="button primary" onClick={() => fileInput.current?.click()}><Camera size={17} /> Cargar comprobante</button><div className="privacy-note"><ShieldCheck size={14} /> Lectura y datos guardados en este dispositivo</div></div> : <div className="table-wrap"><table><thead><tr><th>FECHA</th><th>NÚMERO DE COMPROBANTE</th><th>LOCAL</th><th>MONTO</th><th>RESPALDO</th><th></th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td>{new Date(`${item.date}T12:00:00`).toLocaleDateString('es-VE')}</td><td><b className="receipt-number">{item.receiptNumber || 'Sin número'}</b><small className="bank-cell">{item.bank || 'Banco no indicado'}</small></td><td>{item.location || 'Local sin nombre'}</td><td className="amount-cell">{money.format(item.amount)}</td><td><span className={`sync-pill ${item.synced ? 'synced' : ''}`}><span />{item.synced ? 'En la nube' : 'Solo local'}</span></td><td><button className="icon-button danger" title="Eliminar" onClick={() => void removeReceipt(item)}><Trash2 size={16} /></button></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="no-results">No hay comprobantes que coincidan con la búsqueda.</div>}</div>}
        </section>
        <div className="bottom-tip"><Sparkles size={15} /><span>La lectura automática puede equivocarse. Confirma los datos con el comprobante original antes de guardar.</span></div>
      </section>
    </main>
    <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { void chooseImage(event.target.files?.[0]); event.currentTarget.value = '' }} />
    {modal && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setModal(false)}><section className="receipt-modal"><div className="modal-header"><div><div className="eyebrow">NUEVO REGISTRO</div><h2>Revisar comprobante</h2></div><button className="icon-button" onClick={() => setModal(false)} aria-label="Cerrar"><X size={19} /></button></div><ol className="flow-steps" aria-label="Pasos del registro"><li className="complete"><span><Check size={12} /></span> Foto</li><li className="current"><span>2</span> Revisión</li><li><span>3</span> Guardado</li></ol><div className="modal-content"><div className="photo-column"><div className="photo-frame">{draft.image ? <img src={draft.image} alt="Foto del comprobante" /> : <div className="photo-placeholder"><ImagePlus size={28} /></div>}</div><button type="button" className="replace-photo" onClick={() => fileInput.current?.click()}><Upload size={15} /> Cambiar imagen</button>{ocrBusy && <div className="ocr-status"><LoaderCircle size={16} className="spin" /><span>Leyendo comprobante… {Math.round(progress * 100)}%</span></div>}{!ocrBusy && <div className="ocr-done"><Check size={15} /> Lectura en el dispositivo</div>}</div><form id="receipt-form" onSubmit={(event) => void saveReceipt(event)}><div className="form-intro"><Sparkles size={16} /><span>Confirma los datos detectados y completa los campos pendientes</span></div><label>Fecha<input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} required /><small className="field-hint">Si no se detecta en la foto, usamos la fecha de hoy; puedes corregirla.</small></label><label>Número de comprobante<input value={draft.receiptNumber} onChange={(e) => setDraft({ ...draft, receiptNumber: e.target.value })} placeholder="Ej. 00458291" /></label><label>Local<input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="Nombre del local" /></label><div className="form-grid"><label>Monto (Bs.)<input type="number" min="0" step="0.01" value={draft.amount || ''} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })} placeholder="0,00" required /></label><label>Banco / tarjeta<input list="venezuelan-banks" value={draft.bank} onChange={(e) => setDraft({ ...draft, bank: e.target.value })} placeholder="Busca o escribe un banco" /><datalist id="venezuelan-banks">{venezuelanBanks.map(({ name }) => <option key={name} value={name} />)}</datalist></label></div></form></div><div className="modal-footer"><span><ShieldCheck size={15} />{user ? 'Se guardará local y en Supabase' : 'Se guardará en este dispositivo'}</span><button type="button" className="button secondary" onClick={() => setModal(false)}>Cancelar</button><button type="submit" form="receipt-form" className="button primary" disabled={saving || ocrBusy}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{saving ? 'Guardando…' : 'Guardar comprobante'}</button></div></section></div>}
    {saveResult && <div className="modal-backdrop"><section className={`result-modal ${saveResult.kind}`} role="dialog" aria-modal="true" aria-labelledby="result-title"><div className="result-symbol">{saveResult.kind === 'error' ? <X size={26} /> : <Check size={26} />}</div><div className="eyebrow">CONFIRMACIÓN DE REGISTRO</div><h2 id="result-title">{saveResult.kind === 'cloud' ? 'Comprobante guardado' : saveResult.kind === 'local' ? 'Comprobante guardado en este dispositivo' : 'No se pudo guardar'}</h2><p>{saveResult.kind === 'cloud' ? 'El registro y la imagen quedaron guardados en Supabase y en este navegador.' : saveResult.kind === 'local' ? saveResult.detail || 'El registro quedó guardado en este navegador. Para compartirlo entre PC y teléfono, inicia sesión en Supabase antes de guardar futuros comprobantes.' : saveResult.detail || 'Ocurrió un error al guardar el comprobante.'}</p><button className="button primary" onClick={() => { setSaveResult(null); setMessage(saveResult.kind === 'cloud' ? 'Guardado y sincronizado con Supabase.' : 'Guardado solo en este dispositivo.') }}>Entendido</button></section></div>}
    {authOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setAuthOpen(false)}><section className="auth-modal"><div className="modal-header"><div><div className="eyebrow">RESPALDO EN LA NUBE</div><h2>Inicia sesión</h2></div><button className="icon-button" onClick={() => setAuthOpen(false)}><X size={19} /></button></div><p className="auth-copy">Usa tu cuenta para guardar los comprobantes en tu espacio privado de Supabase.</p><form onSubmit={(event) => void signIn(event)}><label>Correo electrónico<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="tu@correo.com" /></label><label>Contraseña<input type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Mínimo 6 caracteres" /></label><button className="button primary full" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <LogIn size={16} />} Iniciar sesión</button><button type="button" className="create-account" disabled={busy} onClick={() => void signUp()}>Crear una cuenta nueva</button></form></section></div>}
  </div>
}
