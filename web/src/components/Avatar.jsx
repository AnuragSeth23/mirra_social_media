/** Profile photo, or the first letter of the name on the brand colour when there is none. */
export function Avatar({ name, src, size = 40, ring = false }) {
  const style = { width: size, height: size, fontSize: size * 0.42 };
  const cls = `avatar-sm ${ring ? 'ring' : ''}`;
  return src ? (
    <img className={cls} style={style} src={src} alt="" loading="lazy" />
  ) : (
    <span className={cls} style={style} aria-hidden>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
