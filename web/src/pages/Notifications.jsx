import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import { Topbar } from '../components/Topbar';
import { api } from '../lib/api';
import { timeAgo } from '../lib/time';

const TEXT = {
  post_like: 'liked your post.',
  comment: 'commented on your post.',
  comment_reply: 'replied to your comment.',
  follow: 'started following you.',
  follow_request: 'asked to follow you.',
  follow_accepted: 'accepted your follow request.',
};

export function Notifications() {
  const { refreshUser } = useAuth();
  const [items, setItems] = useState(null);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Show what was unread as "new", then mark what was shown as read (newer arrivals stay unread).
    api('/notifications')
      .then((n) => {
        setItems(n);
        const top = n[0]?.id;
        if (top) void api('/notifications/read', { method: 'POST', body: { upToId: top } }).catch(() => {});
      })
      .catch(() => setError(true));
    api('/users/requests')
      .then(setRequests)
      .catch(() => {});
  }, []);

  const respond = async (p, accept) => {
    try {
      await api(`/users/requests/${p.id}`, { method: accept ? 'PUT' : 'DELETE' });
      setRequests((r) => r.filter((x) => x.id !== p.id));
      if (accept) void refreshUser();
    } catch {
      /* it may already have been handled elsewhere; reload the list */ api('/users/requests')
        .then(setRequests)
        .catch(() => {});
    }
  };

  return (
    <div className="app">
      <Topbar />
      <main className="app-main">
        <h1 className="section-title big">Activity</h1>

        {requests.length > 0 && (
          <section className="suggest" aria-label="Follow requests">
            <h2>Follow requests</h2>
            <ul>
              {requests.map((p) => (
                <li key={p.id}>
                  <Avatar name={p.fullName} src={p.avatarUrl} size={40} />
                  <Link to={`/u/${p.username}`} className="plain who">
                    <strong>{p.fullName}</strong>
                    <span>@{p.username}</span>
                  </Link>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => respond(p, true)}>
                    Accept
                  </button>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => respond(p, false)}>
                    Decline
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {error && (
          <div className="empty">
            <h2>Couldn’t load activity</h2>
            <p>Check your connection and try again.</p>
          </div>
        )}
        {!error && !items && (
          <p className="fine center" role="status">
            Loading…
          </p>
        )}
        {items?.length === 0 && requests.length === 0 && (
          <div className="empty">
            <h2>Nothing yet</h2>
            <p>Likes, comments and new followers will show up here.</p>
          </div>
        )}
        <ul className="notes">
          {items?.map((n) => (
            <li key={n.id} className={n.read ? '' : 'new'}>
              <Avatar name={n.actor.fullName} src={n.actor.avatarUrl} size={44} />
              <p>
                <Link to={`/u/${n.actor.username}`} className="plain">
                  <strong>{n.actor.username}</strong>
                </Link>{' '}
                {TEXT[n.type] ?? 'did something.'} <span className="fine">{timeAgo(n.createdAt)}</span>
              </p>
              {n.postId && (
                <Link to={`/post/${n.postId}`} className="note-thumb" aria-label="Open post">
                  {n.thumbUrl ? <img src={n.thumbUrl} alt="" /> : <span>View</span>}
                </Link>
              )}
              {!n.postId && n.type !== 'post_like' && (
                <Link to={`/u/${n.actor.username}`} className="link-btn">
                  View
                </Link>
              )}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
