import { IMPORTED_FILES, WATCH_FOLDER } from '../data/mock';
import { IconFolder } from './icons';

export function SettingsView() {
  return (
    <div className="settings">
      <div className="card">
        <div className="map-card__between">
          <span className="card__title">감시 폴더</span>
          <span className="badge-green">감시 중</span>
        </div>
        <div className="folder">
          <IconFolder />
          <span className="folder__path">{WATCH_FOLDER}</span>
          <div className="btn-sm">폴더 변경</div>
          <div className="btn-sm">일시중지</div>
        </div>
        <div className="folder-meta">
          <span>파일 형식 · .txt / .log / .csv</span>
          <span>인코딩 · UTF-8</span>
          <span>파싱 규칙 · RKSS ATIS</span>
        </div>
      </div>

      <div className="card file-list">
        <div className="file-list__head">최근 가져온 파일</div>
        {IMPORTED_FILES.map((f) => (
          <div key={f.name} className="file-list__row">
            <span className="file-list__name">{f.name}</span>
            <span className="file-list__count">{f.count}건</span>
            <span className="file-list__at">{f.at}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
