import { useEffect, useState, useRef } from 'react';
import { supabase } from './supabaseClient';

const USER_ID = '00000000-0000-0000-0000-000000000001'; // single-user for now

async function recordInteraction(articleId, interactionType, detail = null) {
  await supabase.from('user_interactions').insert({
    user_id: USER_ID,
    article_id: articleId,
    interaction_type: interactionType,
    detail: detail,
  });
}

async function updatePreference(topic, source, delta) {
  // Try to find existing preference
  const { data } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('topic', topic || null)
    .eq('source', source || null)
    .maybeSingle();

  if (data) {
    const newScore = Math.max(-1, Math.min(1, (data.preference_score || 0) + delta));
    await supabase
      .from('user_preferences')
      .update({ preference_score: newScore, last_updated: new Date().toISOString() })
      .eq('id', data.id);
  } else {
    await supabase.from('user_preferences').insert({
      user_id: USER_ID,
      topic: topic || null,
      source: source || null,
      preference_score: delta,
    });
  }
}

function ActionMenu({ article, onClose, onHide }) {
  const menuRef = useRef();

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const topic = article.topics?.[0] || null;
  const source = article.source || null;

  const options = [
    {
      label: `More like "${topic || 'this topic'}"`,
      action: async () => {
        await recordInteraction(article.id, 'more_topic', topic);
        if (topic) await updatePreference(topic, null, 0.3);
        onClose();
      }
    },
    {
      label: `Less like "${topic || 'this topic'}"`,
      action: async () => {
        await recordInteraction(article.id, 'less_topic', topic);
        if (topic) await updatePreference(topic, null, -0.3);
        onClose();
      }
    },
    {
      label: `More from ${source}`,
      action: async () => {
        await recordInteraction(article.id, 'more_source', source);
        if (source) await updatePreference(null, source, 0.3);
        onClose();
      }
    },
    {
      label: `Less from ${source}`,
      action: async () => {
        await recordInteraction(article.id, 'less_source', source);
        if (source) await updatePreference(null, source, -0.3);
        onClose();
      }
    },
    {
      label: `Never show from ${source}`,
      danger: true,
      action: async () => {
        await recordInteraction(article.id, 'never_source', source);
        if (source) await updatePreference(null, source, -1);
        onHide(article.id);
        onClose();
      }
    },
  ];

  return (
    <div
      ref={menuRef}
      className="absolute right-0 bottom-10 bg-white rounded-xl shadow-xl border border-gray-100 z-50 w-64 overflow-hidden"
    >
      {options.map(opt => (
        <button
          key={opt.label}
          onClick={opt.action}
          className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0 ${opt.danger ? 'text-red-500' : 'text-gray-700'}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ArticleCard({ article, onHide }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reaction, setReaction] = useState(null);

  async function handleLike() {
    setReaction('like');
    await recordInteraction(article.id, 'like');
    if (article.topics?.[0]) await updatePreference(article.topics[0], null, 0.2);
    if (article.source) await updatePreference(null, article.source, 0.2);
  }

  async function handleDislike() {
    setReaction('dislike');
    await recordInteraction(article.id, 'dislike');
    if (article.topics?.[0]) await updatePreference(article.topics[0], null, -0.2);
    if (article.source) await updatePreference(null, article.source, -0.2);
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm mb-3 overflow-hidden relative">
      {article.image_url && (
        <img src={article.image_url} alt={article.title} className="w-full h-48 object-cover" />
      )}
      <div className="p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
          {article.source || 'Unknown Source'}
        </p>
        <h2 className="text-base font-semibold text-gray-900 leading-snug mb-2">
          {article.title}
        </h2>
        {article.summary && (
          <p className="text-sm text-gray-600 leading-relaxed mb-3">{article.summary}</p>
        )}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100 relative">
          <div className="flex gap-3">
            <button
              onClick={handleLike}
              className={`text-xl transition-transform hover:scale-110 ${reaction === 'like' ? 'opacity-100' : 'opacity-50'}`}
            >👍</button>
            <button
              onClick={handleDislike}
              className={`text-xl transition-transform hover:scale-110 ${reaction === 'dislike' ? 'opacity-100' : 'opacity-50'}`}
            >👎</button>
          </div>
          <div className="relative">
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="text-gray-400 text-xl px-2 hover:text-gray-600"
            >⋯</button>
            {menuOpen && (
              <ActionMenu
                article={article}
                onClose={() => setMenuOpen(false)}
                onHide={onHide}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [articles, setArticles] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchArticles() {
      let { data, error } = await supabase
        .from('articles')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) setError(error.message);
      else setArticles(data);
    }
    fetchArticles();
  }, []);

  function hideArticle(id) {
    setArticles(prev => prev.filter(a => a.id !== id));
  }

  return (
    <div className="bg-gray-100 min-h-screen">
      <div className="max-w-md mx-auto px-3 py-4">
        <h1 className="text-2xl font-bold text-gray-800 mb-4 px-1">For You</h1>
        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
        {articles.length === 0 ? (
          <p className="text-gray-400 text-center mt-20">No articles yet.</p>
        ) : (
          articles.map(article => (
            <ArticleCard key={article.id} article={article} onHide={hideArticle} />
          ))
        )}
      </div>
    </div>
  );
}

export default App;