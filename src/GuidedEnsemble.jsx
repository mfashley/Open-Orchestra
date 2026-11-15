import './GuidedEnsemble.css';

export default function GuidedEnsemble({ session, guide, host, ready, onStart, onStop, noteNames }) {
  return (
    <section className="guide-panel" aria-label="Guided ensemble">
      <div className="guide-heading">
        <div>
          <p className="guide-kicker">{session ? 'GUIDED ENSEMBLE' : 'FREE PLAY'}</p>
          <h2>{session ? session.title : 'Play a piece together.'}</h2>
        </div>
        {host && (session ? (
          <button className="guide-control" onClick={onStop}>Stop / Free Play</button>
        ) : (
          <button className="guide-control" disabled={!ready} onClick={onStart}>Start First Light</button>
        ))}
      </div>
      {!session ? (
        <p>{host ? 'An eight-bar piece in C major. Enable sound, invite your musicians, then start.' : 'Explore freely. When the host starts a piece, follow the highlighted pads.'}</p>
      ) : guide && (
        <>
          <p className="guide-meta">C major · {session.bpm} BPM · {guide.count ? 'Get ready' : `Bar ${guide.bar} / 8`}</p>
          <div className="guide-beats" aria-hidden="true">
            {[0, 1, 2, 3].map((beat) => <span key={beat} className={guide.pulse === beat ? 'beat-current' : ''}>{beat + 1}</span>)}
          </div>
          <div className="guide-instruction">
            {guide.count ? `Count in: ${guide.count}` : guide.finished ? 'Beautiful. Take a bow.' : host ? 'Your ensemble is performing.' : guide.active.length ? `HOLD ${guide.active.map((pad) => noteNames[pad]).join(' + ')}` : 'Rest — let the other instruments sing.'}
          </div>
          {!host && guide.next.length > 0 && <p>Next: {guide.next.map((pad) => noteNames[pad]).join(' + ')}</p>}
          <div className="guide-progress" aria-hidden="true"><span style={{ width: `${guide.progress}%` }} /></div>
          {!host && <p className="guide-footnote">Gold outline = next notes · Burgundy = play now. You make the sound.</p>}
        </>
      )}
    </section>
  );
}
