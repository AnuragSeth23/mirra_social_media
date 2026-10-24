import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Avatar } from './Avatar';
import { PlusIcon } from './Icons';
import { StoryViewer } from './StoryViewer';

/** The row of circles above the feed: your story first, then people with new stories. */
export function StoriesBar({ me, reloadKey, onAdd }) {
  const [groups, setGroups] = useState([]);
  const [open, setOpen] = useState(null);

  const load = () =>
    api('/stories')
      .then(setGroups)
      .catch(() => {});
  useEffect(() => {
    void load();
  }, [reloadKey]);

  const mine = groups.find((g) => g.mine);
  const others = groups.filter((g) => !g.mine);
  const ordered = mine ? [mine, ...others] : others;
  return (
    <>
      <section className="stories" aria-label="Stories">
        {!mine && (
          <button type="button" className="story-chip add" onClick={onAdd} aria-label="Add to your story">
            <span className="story-ring">
              <Avatar name={me.fullName} src={me.avatarUrl} size={56} />
              <span className="story-plus">
                <PlusIcon />
              </span>
            </span>
            <span className="story-name">Your story</span>
          </button>
        )}
        {ordered.map((g, i) => (
          <div key={g.author.id} className="story-cell">
            <button
              type="button"
              className={`story-chip ${g.allViewed ? 'seen' : ''}`}
              onClick={() => setOpen(i)}
              aria-label={`${g.mine ? 'Your story' : g.author.username + '’s story'}${g.allViewed ? ', seen' : ', new'}`}
            >
              <span className="story-ring">
                <Avatar name={g.author.fullName} src={g.mine ? (me.avatarUrl ?? g.author.avatarUrl) : g.author.avatarUrl} size={56} />
              </span>
              <span className="story-name">{g.mine ? 'Your story' : g.author.username}</span>
            </button>
            {g.mine && (
              <button type="button" className="story-plus corner" onClick={onAdd} aria-label="Add another story">
                <PlusIcon />
              </button>
            )}
          </div>
        ))}
      </section>
      {open !== null && (
        <StoryViewer
          groups={ordered}
          start={open}
          onClose={() => {
            setOpen(null);
            void load();
          }}
          onDeleted={load}
        />
      )}
    </>
  );
}
