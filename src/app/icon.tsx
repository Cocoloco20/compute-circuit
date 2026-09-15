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
          background: '#05060a',
          borderRadius: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            width: 6,
            height: 18,
            background: '#A78BFA',
            borderRadius: 1,
          }}
        />
        <div
          style={{
            display: 'flex',
            width: 6,
            height: 12,
            background: '#A78BFA',
            borderRadius: 1,
            marginLeft: 3,
          }}
        />
        <div
          style={{
            display: 'flex',
            width: 6,
            height: 22,
            background: '#F2F3F5',
            borderRadius: 1,
            marginLeft: 3,
          }}
        />
      </div>
    ),
    { ...size },
  )
}
