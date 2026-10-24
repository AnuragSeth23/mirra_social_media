import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { FollowButton } from './FollowButton';
import { Avatar } from './Avatar';

/** "People to follow". `compact` (narrow screens) shows them as a swipeable strip of cards instead of a tall list. */
export function Suggestions({ onFollowChanged, compact = false }) {
  const [people, setPeople] = useState([]);
  useEffect(() => {
    api('/users/suggestions')
      .then(setPeople)
      .catch(() => {});
  }, []);
  if (!people.length) return null;

  return (
    <section className={`suggest ${compact ? 'strip' : ''}`} aria-label="People to follow">
      <h2>People to follow</h2>
      <ul>
        {people.map((p) => (
          <li key={p.id}>
            <Avatar name={p.fullName} src={p.avatarUrl} size={compact ? 64 : 40} />
            <Link to={`/u/${p.username}`} className="plain who">
              <strong>{p.fullName}</strong>
              <span>
                @{p.username}
                {p.followsYou && ' · follows you'}
              </span>
            </Link>
            <FollowButton userId={p.id} username={p.username} following={p.following} followsYou={p.followsYou} onChange={onFollowChanged} />
          </li>
        ))}
      </ul>
    </section>
  );
}
