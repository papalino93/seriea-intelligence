import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0A0F0C',
        }}
      >
        <span
          style={{
            display: 'flex',
            color: '#ECF2EE',
            fontSize: 76,
            fontWeight: 700,
            letterSpacing: -2,
            lineHeight: 1,
          }}
        >
          SA
        </span>
        <div style={{ display: 'flex', width: 64, height: 8, borderRadius: 4, background: '#3FA66B', marginTop: 14 }} />
        <span
          style={{
            display: 'flex',
            marginTop: 10,
            color: '#8FA096',
            fontSize: 14,
            letterSpacing: 3,
            textTransform: 'uppercase',
          }}
        >
          Intelligence
        </span>
      </div>
    ),
    { ...size }
  )
}
