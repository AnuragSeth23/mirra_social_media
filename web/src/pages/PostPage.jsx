import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PostCard } from '../components/PostCard';
import { Topbar } from '../components/Topbar';
import { api } from '../lib/api';

/** A single post, opened from a shared link. */
export function PostPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    setPost(null);
    setMissing(false);
    api(`/posts/${id}`)
      .then((p) => live && setPost(p))
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <div className="app">
      <Topbar />
      <main className="app-main">
        {missing && (
          <div className="empty">
            <h2>Post not available</h2>
            <p>It may have been deleted, or it belongs to a private account.</p>
            <Link to="/">Back to feed</Link>
          </div>
        )}
        {post && <PostCard key={post.id} post={post} startOpen onChange={setPost} onDelete={() => navigate('/')} />}
      </main>
    </div>
  );
}
