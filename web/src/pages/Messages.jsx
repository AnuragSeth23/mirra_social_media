import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { SearchIcon } from '../components/Icons';
import { Topbar } from '../components/Topbar';
import { api, ApiError } from '../lib/api';
import { timeAgo } from '../lib/time';

export function Messages() {
  const navigate = useNavigate();
  const [chats, setChats] = useState(null);
  const [text, setText] = useState('');
  const [found, setFound] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () =>
      api('/messages')
        .then(setChats)
        .catch(() => setChats((c) => c ?? []));
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = text.trim();
    if (!t) {
      setFound([]);
      return;
    }
    let live = true;
    const h = setTimeout(
      () =>
        api(`/users/search?q=${encodeURIComponent(t)}`)
          .then((r) => live && setFound(r))
          .catch(() => {}),
      300,
    );
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [text]);

  const start = async (userId) => {
    setError('');
    try {
      navigate(`/messages/${(await api(`/messages/with/${userId}`, { method: 'POST' })).id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open the chat.');
    }
  };

  return (
    <div className="app">
      <Topbar />
      <main className="app-main">
        <h1 className="section-title big">Messages</h1>
        <label className="searchbox">
          <SearchIcon />
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Find someone to message" aria-label="Find someone to message" />
        </label>
        {error && (
          <p className="field-msg error" role="alert">
            {error}
          </p>
        )}

        {text.trim() ? (
          <section className="suggest" aria-label="People">
            {found.length === 0 && <p className="fine">No one found.</p>}
            <ul>
              {found.map((p) => (
                <li key={p.id}>
                  <Avatar name={p.fullName} src={p.avatarUrl} size={40} />
                  <div className="who">
                    <strong>{p.fullName}</strong>
                    <span>@{p.username}</span>
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => start(p.id)}>
                    Message
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <>
            {chats === null && (
              <p className="fine center" role="status">
                Loading…
              </p>
            )}
            {chats?.length === 0 && (
              <div className="empty">
                <h2>No messages yet</h2>
                <p>Search for someone above, or tap “Message” on their profile.</p>
              </div>
            )}
            <ul className="chats">
              {chats?.map((c) => (
                <li key={c.id}>
                  <Link to={`/messages/${c.id}`} className="chat-row plain">
                    <Avatar name={c.peer.fullName} src={c.peer.avatarUrl} size={48} />
                    <div className="who">
                      <strong>{c.peer.fullName}</strong>
                      <span className={c.unread ? 'unread' : ''}>{c.lastMessage ?? ''}</span>
                    </div>
                    <span className="fine">{timeAgo(c.lastAt)}</span>
                    {c.unread > 0 && <span className="dot static">{c.unread > 9 ? '9+' : c.unread}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
