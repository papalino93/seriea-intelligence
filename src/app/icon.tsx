import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0A0F0C',
          border: '2px solid #3FA66B',
          borderRadius: 7,
        }}
      >
        <div
          style={{
            display: 'flex',
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: '#3FA66B',
          }}
        />
      </div>
    ),
    { ...size }
  )
}
