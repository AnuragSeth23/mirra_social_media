import { Link } from 'react-router-dom';
import { Topbar } from '../components/Topbar';

export function NotFound() {
  return (
    <div className="app">
      <Topbar />
      <main className="app-main">
        <div className="empty">
          <h2>Page not found</h2>
          <p>That link doesn’t lead anywhere on SocialAmbak.</p>
          <Link to="/">Back to Home</Link>
        </div>
      </main>
    </div>
  );
}
