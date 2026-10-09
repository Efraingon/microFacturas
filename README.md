# MicroFacturas

MicroFacturas es una microaplicación web para registrar comprobantes de pago emitidos por puntos de venta en comercios. Su objetivo es reducir el trabajo manual: el usuario fotografía o selecciona el recibo, revisa la información que pudo reconocer la aplicación y confirma el registro. Los datos pueden conservarse en el dispositivo y, al configurar Supabase, sincronizarse con una cuenta y guardar la imagen en la nube.

## Flujo principal

1. El usuario captura una foto del comprobante o la selecciona desde el teléfono o la computadora.
2. El OCR intenta detectar la fecha, el número o referencia, el local, el monto y el banco o tarjeta.
3. El usuario revisa y corrige los campos antes de guardar. La lectura automática no sustituye la validación visual del recibo.
4. La aplicación guarda el registro en IndexedDB y permite exportar Fecha, Número de comprobante, Local y Monto a Excel.
5. Si el usuario inicia sesión, el registro y la imagen se guardan en Supabase, vinculados al usuario.

La interfaz está en español, es adaptable a móviles y escritorio y usa una paleta neutra cálida con verde petróleo. El manifiesto web permite preparar la aplicación para instalación como acceso directo. El modo sin conexión completo y la instalación PWA en producción requieren configuración adicional de servicio, HTTPS e iconos.

## Tecnologías

| Área | Tecnología | Función |
| --- | --- | --- |
| Interfaz | React 19, TypeScript 5 | Pantallas, formularios y estado de la aplicación |
| Desarrollo y compilación | Vite 6 | Servidor local y compilación de producción |
| OCR | Tesseract.js 6 (`spa`) | Lectura local asistida de texto en comprobantes |
| Preparación de imágenes | Canvas API del navegador | Recorte aproximado del papel, escala y mejora de contraste |
| Persistencia local | IndexedDB | Registros e imágenes en el navegador del dispositivo |
| Base de datos | Supabase PostgreSQL | Registros compartidos con la cuenta autenticada |
| Identidad | Supabase Auth | Registro e inicio de sesión por correo y contraseña |
| Imágenes en nube | Supabase Storage | Bucket privado `comprobantes` |
| Seguridad de datos | Row Level Security (RLS) | Aislamiento de registros e imágenes por usuario |
| Excel | SheetJS (`xlsx`) | Generación de archivos `.xlsx` |
| Iconos | Lucide React | Iconografía de la interfaz |

## Requisitos

- Node.js 20 o superior.
- Un navegador moderno. Para probar la captura desde el teléfono, el navegador puede abrir el selector de cámara al cargar una imagen.
- Opcional: un proyecto Supabase para habilitar cuentas y respaldo en la nube.

## Ejecución local

```bash
pnpm install
pnpm dev
```

Para generar la compilación de producción:

```bash
pnpm build
pnpm preview
```

También se puede usar `npm install`, `npm run dev`, `npm run build` y `npm run preview`.

### Probar desde un teléfono en la misma red

```bash
pnpm dev --host 0.0.0.0
```

Abre desde el teléfono `http://IP-LOCAL-DE-LA-COMPUTADORA:5173/`. La computadora y el teléfono deben tener conectividad entre sí. El servidor Vite es de desarrollo y no debe exponerse en una red pública.

## Configurar Supabase

1. Crea un proyecto en Supabase.
2. En **SQL Editor**, ejecuta [`supabase/schema.sql`](supabase/schema.sql). El script crea `public.receipts`, índices, políticas RLS, el bucket privado y las políticas de acceso a las imágenes.
3. En **Authentication → Sign-in methods**, habilita Email/Password.
4. Copia `.env.example` a `.env.local` y completa la URL del proyecto y su clave pública (`sb_publishable_...` o la clave `anon` del proyecto):

```dotenv
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_CLAVE_PUBLICA
```

5. Reinicia el servidor de desarrollo.

No pongas una clave `service_role` en el navegador ni en variables `VITE_*`. `.env.local` está excluido de Git. Las cuentas las administra Supabase Auth; no se crea una tabla de contraseñas propia.

### Esquema de datos

La tabla `public.receipts` contiene `id`, `user_id`, `date`, `receipt_number`, `location`, `amount`, `bank`, `image_path` y `created_at`. El bucket `comprobantes` es privado y organiza cada imagen bajo la carpeta del UUID del usuario. Las políticas RLS restringen cada registro y archivo a su propietario.

## Exportación de Excel

El archivo exportado usa las columnas **Fecha**, **Número de comprobante**, **Local** y **Monto**. Banco e imagen se conservan en el registro local o en la nube, pero no se incluyen en el Excel solicitado inicialmente.

## Limitaciones conocidas

- Los formatos de comprobantes varían entre bancos y terminales. El OCR funciona como sugerencia; puede omitir o confundir datos, sobre todo en fotos borrosas, inclinadas o con fondos complejos.
- Hay que confirmar fecha, referencia, local, monto y banco antes de guardar.
- Los registros locales previos no se sincronizan automáticamente al iniciar sesión por primera vez.
- La aplicación carga registros de nube al iniciar sesión, pero la imagen remota no se descarga al dispositivo a menos que exista ya una copia local.
- El plan gratuito de cualquier proveedor puede cambiar sus cuotas y condiciones; revisa el panel de Supabase antes de usarlo en producción.

## Estructura

```text
src/
  App.tsx              Pantallas, autenticación, guardado y exportación
  styles.css           Diseño adaptable y componentes visuales
  lib/ocr.ts           Preparación de imagen y extracción OCR
  lib/storage.ts       Persistencia IndexedDB
  lib/supabase.ts      Cliente opcional de Supabase
supabase/schema.sql    Tablas, bucket y políticas RLS
```
