import { CheckCircle2, type LucideIcon } from "lucide-react";
import styles from "./planned.module.css";

export function Planned({ icon: Icon, title, text, items }: { icon: LucideIcon; title: string; text: string; items: string[] }) {
  return (
    <section className={styles.wrap} aria-labelledby="planned-title">
      <div className={styles.glow} aria-hidden="true" />
      <span className={styles.icon}>
        <Icon size={26} />
      </span>
      <h2 id="planned-title" className={styles.title}>
        {title}
      </h2>
      <p className={styles.text}>{text}</p>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item}>
            <CheckCircle2 size={16} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
