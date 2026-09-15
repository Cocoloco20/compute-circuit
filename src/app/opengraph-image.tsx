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
          justifyContent: 'center',
          padding: '90px 100px',
          background: '#05060a',
          color: '#F2F3F5',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            fontSize: 22,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: '#6B6F7A',
            marginBottom: 28,
          }}
        >
          <div style={{ display: 'flex', width: 10, height: 10, borderRadius: 5, background: '#A78BFA', marginRight: 16 }} />
          OFFTAKE
        </div>
        <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, lineHeight: 1.15, maxWidth: 900 }}>
          The ledger of disclosed AI compute contracts.
        </div>
        <div style={{ display: 'flex', fontSize: 26, color: '#A5A8B0', marginTop: 32, maxWidth: 820, lineHeight: 1.5 }}>
          Every colocation lease, GPU cloud deal, hosting agreement and power
          contract a public company has disclosed — read straight from the
          SEC filing it appeared in.
        </div>
      </div>
    ),
    { ...size },
  )
}
