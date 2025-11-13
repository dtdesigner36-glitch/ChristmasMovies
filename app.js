const { useEffect, useMemo, useState } = React;

// 🔧 НАСТРОЙКИ SUPABASE — ВСТАВЬ СВОИ ДАННЫЕ:
const SUPABASE_URL = "https://kvfmvbfmkkkmoewyjtfu.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2Zm12YmZta2trbW9ld3lqdGZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5Nzk4NTQsImV4cCI6MjA3ODU1NTg1NH0.uPBy77qj0WFdTN7h1fIcxaKAKtwWu690kkElThEbFwk";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// mshots превью постера по ссылке (базовый URL)
const BASE_SHOT = (url) =>
  `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=640`;

// только для запоминания последнего ника на этом устройстве
const LS_LAST_NICK = "xmas_last_nick_cloud_v5";
function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function App() {
  const [movies, setMovies] = useState([]);
  const [loadingMovies, setLoadingMovies] = useState(true);

  const [allowRegistration, setAllowRegistration] = useState(true);

  const [currentUser, setCurrentUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showNickModal, setShowNickModal] = useState(true);

  const [userWatched, setUserWatched] = useState(new Set());
  const [userReactions, setUserReactions] = useState({});
  const [movieReactions, setMovieReactions] = useState({});

  const [query, setQuery] = useState("");
  const [onlyUnwatched, setOnlyUnwatched] = useState(false);
  const [onlyLiked, setOnlyLiked] = useState(false);

  const [addingMovie, setAddingMovie] = useState(false);
  const [newMovieTitle, setNewMovieTitle] = useState("");
  const [newMovieLink, setNewMovieLink] = useState("");

  const [editingMovieId, setEditingMovieId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editLink, setEditLink] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 24;

  // 💡 кэш-бастер для конкретного фильма: { [movieId]: timestamp }
  const [posterCacheBust, setPosterCacheBust] = useState({});

  // начальная загрузка настроек, фильмов и общих лайков
  useEffect(() => {
    (async () => {
      try {
        // SETTINGS
        const { data: settingsRows, error: settingsErr } = await supabase
          .from("settings")
          .select("id,allow_registration")
          .limit(1);

        if (!settingsErr && settingsRows && settingsRows.length) {
          setAllowRegistration(!!settingsRows[0].allow_registration);
        } else {
          setAllowRegistration(true);
        }

        // MOVIES
        const { data: movieRows, error: movieErr } = await supabase
          .from("movies")
          .select("id,title,link")
          .order("title", { ascending: true });

        if (!movieErr && movieRows) {
          setMovies(movieRows);
        } else {
          console.error("Ошибка загрузки фильмов:", movieErr);
        }

        // GLOBAL REACTIONS
        const { data: allReacts, error: reactErr } = await supabase
          .from("reactions")
          .select("movie_id,reaction");

        if (!reactErr && allReacts) {
          const agg = {};
          for (const r of allReacts) {
            if (!agg[r.movie_id]) agg[r.movie_id] = { likes: 0, dislikes: 0 };
            if (r.reaction === 1) agg[r.movie_id].likes++;
            if (r.reaction === -1) agg[r.movie_id].dislikes++;
          }
          setMovieReactions(agg);
        } else if (reactErr) {
          console.error("Ошибка загрузки реакций:", reactErr);
        }
      } catch (e) {
        console.error("init error", e);
      } finally {
        setLoadingMovies(false);
      }
    })();
  }, []);

  // фильтрация
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return movies
      .filter((m) => !q || m.title.toLowerCase().includes(q))
      .filter((m) => !onlyUnwatched || !userWatched.has(m.id))
      .filter((m) => !onlyLiked || userReactions[m.id] === 1);
  }, [movies, query, onlyUnwatched, onlyLiked, userWatched, userReactions]);

  // при изменении фильтров / списка сбрасываем страницу на 1
  useEffect(() => {
    setCurrentPage(1);
  }, [query, onlyUnwatched, onlyLiked, movies.length]);

  // пагинация
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, pageCount);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const paginated = filtered.slice(startIndex, startIndex + PAGE_SIZE);

  // ─────────── ВХОД / РЕГИСТРАЦИЯ ───────────

  async function loadUserState(userId) {
    try {
      const { data: wRows, error: wErr } = await supabase
        .from("watched")
        .select("movie_id")
        .eq("user_id", userId);

      if (!wErr && wRows) {
        setUserWatched(new Set(wRows.map((r) => r.movie_id)));
      } else {
        setUserWatched(new Set());
      }

      const { data: rRows, error: rErr } = await supabase
        .from("reactions")
        .select("movie_id,reaction")
        .eq("user_id", userId);

      if (!rErr && rRows) {
        const map = {};
        for (const r of rRows) map[r.movie_id] = r.reaction;
        setUserReactions(map);
      } else {
        setUserReactions({});
      }
    } catch (e) {
      console.error("loadUserState error:", e);
      setUserWatched(new Set());
      setUserReactions({});
    }
  }

  // onSubmit из модалки
  async function handleAuth({ nickname, password, mode }) {
    const nick = (nickname || "").trim();
    const pass = (password || "").trim();

    if (!nick) {
      alert("Введите ник");
      return;
    }
    if (!pass) {
      alert("Введите пароль");
      return;
    }

    try {
      if (mode === "login") {
        // ВХОД
        const { data: rows, error } = await supabase
          .from("users")
          .select("id,nickname,is_admin,password")
          .eq("nickname", nick)
          .limit(1);

        if (error) {
          console.error("Ошибка поиска пользователя:", error);
          alert("Ошибка входа");
          return;
        }

        if (!rows || !rows.length) {
          alert("Пользователь с таким ником не найден");
          return;
        }

        const user = rows[0];

        if (!user.password || user.password !== pass) {
          alert("Неверный пароль");
          return;
        }

        setCurrentUser(user);
        setIsAdmin(!!user.is_admin);
        lsSet(LS_LAST_NICK, nick);
        setShowNickModal(false);
        await loadUserState(user.id);
      } else {
        // РЕГИСТРАЦИЯ
        if (!allowRegistration) {
          alert(
            "Регистрация сейчас выключена. Можно зайти только под существующим ником."
          );
          return;
        }

        const { data: existing, error: exErr } = await supabase
          .from("users")
          .select("id")
          .eq("nickname", nick)
          .limit(1);

        if (exErr) {
          console.error("Ошибка проверки ника:", exErr);
          alert("Ошибка регистрации");
          return;
        }

        if (existing && existing.length) {
          alert("Такой ник уже существует. Пожалуйста, придумай другой.");
          return;
        }

        const { data: newUser, error: insErr } = await supabase
          .from("users")
          .insert({ nickname: nick, password: pass })
          .select("id,nickname,is_admin,password")
          .single();

        if (insErr) {
          console.error("Ошибка создания пользователя:", insErr);
          alert("Не удалось создать пользователя");
          return;
        }

        setCurrentUser(newUser);
        setIsAdmin(!!newUser.is_admin);
        lsSet(LS_LAST_NICK, nick);
        setShowNickModal(false);
        await loadUserState(newUser.id);
      }
    } catch (e) {
      console.error("handleAuth error:", e);
      alert("Ошибка входа / регистрации");
    }
  }

  function logout() {
    setCurrentUser(null);
    setIsAdmin(false);
    setUserWatched(new Set());
    setUserReactions({});
    setShowNickModal(true);
  }

  // ─────────── ПРОСМОТРЕНО ───────────

  async function toggleWatch(movieId) {
    if (!currentUser) {
      setShowNickModal(true);
      return;
    }
    const userId = currentUser.id;
    const already = userWatched.has(movieId);

    setUserWatched((prev) => {
      const s = new Set(prev);
      already ? s.delete(movieId) : s.add(movieId);
      return s;
    });

    try {
      if (already) {
        await supabase
          .from("watched")
          .delete()
          .eq("user_id", userId)
          .eq("movie_id", movieId);
      } else {
        await supabase
          .from("watched")
          .insert({ user_id: userId, movie_id: movieId });
      }
    } catch (e) {
      console.error("toggleWatch error:", e);
    }
  }

  // ─────────── ЛАЙКИ / ДИЗЫ ───────────

  async function toggleReaction(movieId, value) {
    if (!currentUser) {
      setShowNickModal(true);
      return;
    }
    const userId = currentUser.id;
    const prevVal = userReactions[movieId] || 0;
    const nextVal = prevVal === value ? 0 : value;

    setUserReactions((prev) => {
      const n = { ...prev };
      if (nextVal === 0) delete n[movieId];
      else n[movieId] = nextVal;
      return n;
    });

    setMovieReactions((prev) => {
      const curr = prev[movieId] || { likes: 0, dislikes: 0 };
      const n = { ...prev };
      const updated = { ...curr };
      if (prevVal === 1) updated.likes--;
      if (prevVal === -1) updated.dislikes--;
      if (nextVal === 1) updated.likes++;
      if (nextVal === -1) updated.dislikes++;
      n[movieId] = updated;
      return n;
    });

    try {
      if (nextVal === 0) {
        await supabase
          .from("reactions")
          .delete()
          .eq("user_id", userId)
          .eq("movie_id", movieId);
      } else {
        await supabase.from("reactions").upsert(
          { user_id: userId, movie_id: movieId, reaction: nextVal },
          { onConflict: "user_id,movie_id" }
        );
      }
    } catch (e) {
      console.error("reaction error:", e);
    }
  }

  // ─────────── РЕГИСТРАЦИЯ ВКЛ/ВЫКЛ (только админ) ───────────

  async function toggleRegistration() {
    if (!isAdmin) return;
    const next = !allowRegistration;
    setAllowRegistration(next);
    try {
      await supabase
        .from("settings")
        .upsert({ id: 1, allow_registration: next }, { onConflict: "id" });
    } catch (e) {
      console.error("settings error:", e);
    }
  }

  // ─────────── ДОБАВЛЕНИЕ ФИЛЬМА (админ) ───────────

  async function handleAddMovie(e) {
    e.preventDefault();
    if (!isAdmin) return;

    const title = newMovieTitle.trim();
    const link = newMovieLink.trim();
    if (!title || !link) {
      alert("Заполни название и ссылку");
      return;
    }

    try {
      setAddingMovie(true);
      const { data, error } = await supabase
        .from("movies")
        .insert({ title, link })
        .select("id,title,link")
        .single();

      if (error) {
        console.error("add movie error:", error);
        alert("Не удалось добавить фильм");
      } else if (data) {
        setMovies((prev) =>
          [...prev, data].sort((a, b) =>
            a.title.localeCompare(b.title, "ru")
          )
        );
        setNewMovieTitle("");
        setNewMovieLink("");
      }
    } catch (e) {
      console.error("add movie error:", e);
    } finally {
      setAddingMovie(false);
    }
  }

  // ─────────── РЕДАКТИРОВАНИЕ / УДАЛЕНИЕ ФИЛЬМА (админ) ───────────

  function startEditMovie(movie) {
    if (!isAdmin) return;
    setEditingMovieId(movie.id);
    setEditTitle(movie.title);
    setEditLink(movie.link);
  }

  function cancelEditMovie() {
    setEditingMovieId(null);
    setEditTitle("");
    setEditLink("");
  }

  async function saveEditMovie(movieId) {
    if (!isAdmin) return;
    const title = editTitle.trim();
    const link = editLink.trim();
    if (!title || !link) {
      alert("Заполни название и ссылку");
      return;
    }
    try {
      const { data, error } = await supabase
        .from("movies")
        .update({ title, link })
        .eq("id", movieId)
        .select("id,title,link")
        .single();

      if (error) {
        console.error("update movie error:", error);
        alert("Не удалось сохранить изменения");
      } else if (data) {
        setMovies((prev) =>
          prev
            .map((m) => (m.id === movieId ? data : m))
            .sort((a, b) => a.title.localeCompare(b.title, "ru"))
        );
        // при изменении ссылки ломаем кэш постера, чтобы при следующей перезагрузке был новый
        setPosterCacheBust((prev) => {
          const n = { ...prev };
          delete n[movieId];
          return n;
        });
        cancelEditMovie();
      }
    } catch (e) {
      console.error("update movie error:", e);
    }
  }

  async function deleteMovie(movieId) {
    if (!isAdmin) return;
    if (!window.confirm("Удалить этот фильм? Это действие нельзя отменить.")) {
      return;
    }
    try {
      const { error } = await supabase
        .from("movies")
        .delete()
        .eq("id", movieId);

      if (error) {
        console.error("delete movie error:", error);
        alert("Не удалось удалить фильм");
        return;
      }

      setMovies((prev) => prev.filter((m) => m.id !== movieId));
      setUserWatched((prev) => {
        const s = new Set(prev);
        s.delete(movieId);
        return s;
      });
      setUserReactions((prev) => {
        const n = { ...prev };
        delete n[movieId];
        return n;
      });
      setMovieReactions((prev) => {
        const n = { ...prev };
        delete n[movieId];
        return n;
      });
      setPosterCacheBust((prev) => {
        const n = { ...prev };
        delete n[movieId];
        return n;
      });
      if (editingMovieId === movieId) {
        cancelEditMovie();
      }
    } catch (e) {
      console.error("delete movie error:", e);
    }
  }

  // ─────────── ОБНОВЛЕНИЕ ПОСТЕРА (админ) ───────────

  function refreshPoster(movieId) {
    if (!isAdmin) return;
    // ставим для фильма новый timestamp — он попадёт в &cb= и точно собьёт кэш браузера
    setPosterCacheBust((prev) => ({
      ...prev,
      [movieId]: Date.now(),
    }));
  }

  // получить итоговый src для постера
  function getPosterSrc(movie) {
    const base = BASE_SHOT(movie.link);
    const cb = posterCacheBust[movie.id];
    if (!cb) return base;
    // base уже с ?w=640, добавляем ещё &cb=
    return `${base}&cb=${cb}`;
  }

  return (
    <>
      {showNickModal && (
        <NickModal
          defaultNick={lsGet(LS_LAST_NICK, "")}
          allowRegistration={allowRegistration}
          onSubmit={handleAuth}
        />
      )}

      <header className="app-bar elevation-2" aria-hidden={showNickModal}>
        <div className="app-title">🎄 Фільми на 2025 — Christmas Movies</div>

        <button
          className={"md-btn chip " + (onlyUnwatched ? "active" : "")}
          onClick={() => setOnlyUnwatched((v) => !v)}
        >
          <span className="material-symbols-rounded">
            {onlyUnwatched ? "visibility" : "visibility_off"}
          </span>
          <span>{onlyUnwatched ? "Все" : "Непросмотренные"}</span>
        </button>

        <button
          className={"md-btn chip " + (onlyLiked ? "active" : "")}
          onClick={() => setOnlyLiked((v) => !v)}
        >
          <span className="material-symbols-rounded">thumb_up</span>
          <span>{onlyLiked ? "Все" : "Понравившиеся"}</span>
        </button>

        <div className="actions">
          <div className="search-wrap">
            <span className="material-symbols-rounded">search</span>
            <input
              type="search"
              placeholder="Поиск по названию…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <span className="badge">{currentUser?.nickname ?? "—"}</span>
          <button className="md-btn tonal" onClick={logout}>
            <span className="material-symbols-rounded">person</span>
            <span>Сменить ник</span>
          </button>
        </div>
      </header>

      <main aria-hidden={showNickModal}>
        {loadingMovies && (
          <div className="empty">Загружаем список фильмов…</div>
        )}

        {!loadingMovies && movies.length === 0 && (
          <div className="empty">
            Пока нет ни одного фильма. Зайди как админ и добавь список 🎬
          </div>
        )}

        {filtered.length > 0 && (
          <div className="pagination">
            <button
              type="button"
              className="md-btn chip"
              disabled={safePage === 1}
              onClick={() =>
                setCurrentPage((p) => (p > 1 ? p - 1 : p))
              }
            >
              <span className="material-symbols-rounded">chevron_left</span>
              <span>Назад</span>
            </button>
            <span className="pagination-info">
              Страница {safePage} из {pageCount} • Всего фильмов:{" "}
              {filtered.length}
            </span>
            <button
              type="button"
              className="md-btn chip"
              disabled={safePage === pageCount}
              onClick={() =>
                setCurrentPage((p) =>
                  p < pageCount ? p + 1 : p
                )
              }
            >
              <span>Вперёд</span>
              <span className="material-symbols-rounded">chevron_right</span>
            </button>
          </div>
        )}

        <div className="grid">
          {filtered.length === 0 && movies.length > 0 && (
            <div className="empty">Ничего не найдено по фильтру</div>
          )}

          {paginated.map((movie) => {
            const isW = userWatched.has(movie.id);
            const myR = userReactions[movie.id] || 0;
            const counts = movieReactions[movie.id] || {
              likes: 0,
              dislikes: 0,
            };
            const isEditing = editingMovieId === movie.id;

            return (
              <article
                key={movie.id}
                className={"card elevation-1" + (isW ? " is-watched" : "")}
              >
                <div className="poster-wrap">
                  <img
                    className="poster"
                    loading="lazy"
                    alt={movie.title}
                    src={getPosterSrc(movie)}
                    onError={(e) => {
                      const svg = encodeURIComponent(
                        `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'>
                           <rect width='100%' height='100%' fill='#1f1f1f'/>
                           <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle'
                             font-family='Inter, system-ui' font-size='24' fill='#9aa0a6'>${movie.title}</text>
                         </svg>`
                      );
                      e.currentTarget.src =
                        "data:image/svg+xml;charset=utf-8," + svg;
                    }}
                  />
                  <button
                    className={
                      "watched-toggle " +
                      (isW ? "watched-on" : "watched-off")
                    }
                    onClick={() => toggleWatch(movie.id)}
                  >
                    <span className="material-symbols-rounded">
                      {isW ? "check_circle" : "radio_button_unchecked"}
                    </span>
                    <span>{isW ? "Просмотрено" : "Не просмотрено"}</span>
                  </button>
                </div>

                <div className="card-body">
                  {isEditing ? (
                    <>
                      <input
                        className="input input-full"
                        placeholder="Название фильма"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                      />
                      <input
                        className="input input-full"
                        placeholder="Ссылка на фильм"
                        value={editLink}
                        onChange={(e) => setEditLink(e.target.value)}
                      />
                      <div
                        className="row"
                        style={{ justifyContent: "flex-end" }}
                      >
                        <button
                          type="button"
                          className="md-btn tonal"
                          onClick={cancelEditMovie}
                        >
                          Отмена
                        </button>
                        <button
                          type="button"
                          className="md-btn"
                          onClick={() => saveEditMovie(movie.id)}
                        >
                          Сохранить
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h3 className="title">{movie.title}</h3>

                      {isAdmin && (
                        <div className="admin-controls">
                          <button
                            type="button"
                            className="admin-icon-btn"
                            title="Редактировать"
                            onClick={() => startEditMovie(movie)}
                          >
                            <span className="material-symbols-rounded">
                              edit
                            </span>
                          </button>
                          <button
                            type="button"
                            className="admin-icon-btn"
                            title="Удалить"
                            onClick={() => deleteMovie(movie.id)}
                          >
                            <span className="material-symbols-rounded">
                              delete
                            </span>
                          </button>
                          <button
                            type="button"
                            className="admin-icon-btn"
                            title="Обновить постер"
                            onClick={() => refreshPoster(movie.id)}
                          >
                            <span className="material-symbols-rounded">
                              refresh
                            </span>
                          </button>
                        </div>
                      )}

                      <div className="reactions">
                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            flexWrap: "wrap",
                          }}
                        >
                          <button
                            className={
                              "react-btn " + (myR === 1 ? "active-like" : "")
                            }
                            onClick={() => toggleReaction(movie.id, 1)}
                          >
                            <span className="material-symbols-rounded">
                              thumb_up
                            </span>
                            <span>{counts.likes}</span>
                          </button>
                          <button
                            className={
                              "react-btn " +
                              (myR === -1 ? "active-dislike" : "")
                            }
                            onClick={() => toggleReaction(movie.id, -1)}
                          >
                            <span className="material-symbols-rounded">
                              thumb_down
                            </span>
                            <span>{counts.dislikes}</span>
                          </button>
                        </div>
                        <div className="counts">
                          <span>👍 / 👎 общие для всех</span>
                        </div>
                      </div>

                      <a
                        className="md-btn link-btn"
                        href={movie.link}
                        target="_blank"
                        rel="noopener"
                      >
                        <span className="material-symbols-rounded">
                          open_in_new
                        </span>
                        <span>Смотреть</span>
                      </a>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </main>

      <footer className="footer" aria-hidden={showNickModal}>
        <div className="footer-section">
          <span>
            👤 Ник: <strong>{currentUser?.nickname ?? "не выбран"}</strong>
          </span>
        </div>
        <span className="divider" />
        <div className="footer-section">
          <span>
            Регистрация:&nbsp;
            <span
              className="badge-small"
              style={{
                background: allowRegistration ? "#14532d" : "#4b1f1f",
                borderColor: allowRegistration ? "#16a34a" : "#b91c1c",
              }}
            >
              {allowRegistration ? "включена" : "выключена"}
            </span>
          </span>
        </div>

        {isAdmin && (
          <div
            className="footer-section"
            style={{
              flexDirection: "column",
              alignItems: "flex-start",
              width: "100%",
            }}
          >
            <div className="admin-panel">
              <span className="toggle-indicator">
                <span className="material-symbols-rounded">
                  admin_panel_settings
                </span>
                Админ-режим включён
              </span>
              <button
                className="md-btn chip"
                type="button"
                onClick={toggleRegistration}
              >
                <span className="material-symbols-rounded">lock_open</span>
                <span>
                  {allowRegistration
                    ? "Выключить регистрацию"
                    : "Включить регистрацию"}
                </span>
              </button>
            </div>

            <form className="admin-panel" onSubmit={handleAddMovie}>
              <input
                className="input input-full"
                placeholder="Название фильма"
                value={newMovieTitle}
                onChange={(e) => setNewMovieTitle(e.target.value)}
              />
              <input
                className="input input-full"
                placeholder="Ссылка на фильм (Rezka / YouTube)"
                value={newMovieLink}
                onChange={(e) => setNewMovieLink(e.target.value)}
              />
              <button className="md-btn" type="submit" disabled={addingMovie}>
                <span className="material-symbols-rounded">add</span>
                <span>{addingMovie ? "Добавление…" : "Добавить фильм"}</span>
              </button>
            </form>
          </div>
        )}
      </footer>
    </>
  );
}

// Модалка: вход / регистрация
function NickModal({ defaultNick, allowRegistration, onSubmit }) {
  const [nickname, setNickname] = useState(defaultNick || "");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("login"); // 'login' | 'register'

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit({ nickname, password, mode });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal elevation-2" onSubmit={handleSubmit}>
        <h2>Добро пожаловать 🎄</h2>

        <div className="row" style={{ marginTop: "4px" }}>
          <button
            type="button"
            className={"md-btn chip " + (mode === "login" ? "active" : "")}
            onClick={() => setMode("login")}
          >
            Вход
          </button>
          <button
            type="button"
            className={"md-btn chip " + (mode === "register" ? "active" : "")}
            onClick={() => setMode("register")}
            disabled={!allowRegistration}
          >
            Регистрация
          </button>
        </div>

        <div className="sub">
          {mode === "login" ? (
            <div className="hint" style={{ marginTop: "4px" }}>
              Введите свой ник и пароль, чтобы войти.
            </div>
          ) : (
            <div className="hint" style={{ marginTop: "4px" }}>
              Придумайте ник и пароль.{" "}
              {allowRegistration ? (
                <strong>Регистрация открыта.</strong>
              ) : (
                <strong>Сейчас регистрация закрыта.</strong>
              )}
            </div>
          )}
        </div>

        <div className="row">
          <input
            className="input input-full"
            autoFocus
            placeholder="Никнейм (например: Denis)"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </div>

        <div className="row">
          <input
            className="input input-full"
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="md-btn" type="submit">
            <span className="material-symbols-rounded">login</span>
            <span>{mode === "login" ? "Войти" : "Зарегистрироваться"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
