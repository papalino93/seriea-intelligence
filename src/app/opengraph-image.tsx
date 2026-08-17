import { ImageResponse } from 'next/og'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          background: '#0A0F0C',
          padding: '80px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              width: 64,
              height: 64,
              borderRadius: 14,
              border: '4px solid #3FA66B',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ display: 'flex', width: 24, height: 24, borderRadius: '50%', background: '#3FA66B' }} />
          </div>
          <span style={{ color: '#8FA096', fontSize: 28, letterSpacing: 4, textTransform: 'uppercase' }}>
            Serie A Intelligence
          </span>
        </div>
        <div style={{ display: 'flex', color: '#ECF2EE', fontSize: 68, fontWeight: 700, marginTop: 40, maxWidth: 900 }}>
          Analisi quantitativa della Serie A
        </div>
        <div style={{ display: 'flex', color: '#8FA096', fontSize: 32, marginTop: 24, maxWidth: 800 }}>
          Previsioni, quote, value e commento IA su ogni giornata
        </div>
      </div>
    ),
    { ...size }
  )
}
