import type { Coordinate } from "@ride-maker/domain";
import { type GeocodingResult, type GeocodingProvider } from "@ride-maker/geocoding";
import { useEffect, useState, type ChangeEvent } from "react";
import { css, html } from "react-strict-dom";
import { tokens } from "../../../packages/ui/src/tokens.css";

const styles = css.create({
  wrapper: { position: "relative" },
  input: {
    backgroundColor: "transparent", borderStyle: "none", color: tokens.ink,
    fontFamily: tokens.font, fontSize: 14, fontWeight: 700, minWidth: 0,
    padding: 0, width: "100%",
  },
  results: {
    backgroundColor: tokens.surface, borderColor: tokens.border, borderRadius: 8,
    borderStyle: "solid", borderWidth: 1, boxShadow: "0 8px 24px rgba(23, 33, 29, 0.16)",
    display: "flex", flexDirection: "column", left: -8, listStyle: "none",
    margin: 0, padding: 4, position: "absolute", right: -42, top: 28, zIndex: 10,
  },
  resultButton: {
    backgroundColor: { default: "transparent", ":hover": tokens.canvas },
    borderStyle: "none", borderRadius: 6, color: tokens.ink, cursor: "pointer",
    fontFamily: tokens.font, fontSize: 12, lineHeight: 1.35, padding: 8,
    textAlign: "left", width: "100%",
  },
});

type Props = {
  focus: Coordinate;
  label: string;
  onNameChange: (name: string) => void;
  onSelect: (result: GeocodingResult) => void;
  provider: GeocodingProvider;
  value: string;
};

export function PlaceSearchInput({ focus, label, onNameChange, onSelect, provider, value }: Props) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [searchEnabled, setSearchEnabled] = useState(false);

  useEffect(() => setQuery(value), [value]);

  useEffect(() => {
    if (!searchEnabled || query.trim().length < 3) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void provider.search(query, { focus, signal: controller.signal })
        .then(setResults)
        .catch(() => { if (!controller.signal.aborted) setResults([]); });
    }, 300);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [focus.latitude, focus.longitude, provider, query, searchEnabled]);

  return (
    <html.div style={styles.wrapper}>
      <html.input
        aria-label={`${label} name or place`}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const nextValue = event.currentTarget.value;
          setQuery(nextValue);
          setSearchEnabled(true);
          onNameChange(nextValue);
        }}
        placeholder={`Search ${label.toLowerCase()}`}
        style={styles.input}
        type="text"
        value={query}
      />
      {results.length === 0 ? null : (
        <html.ul style={styles.results}>
          {results.map((result) => (
            <html.li key={result.id}>
              <html.button
                onClick={() => {
                  setQuery(result.name);
                  setSearchEnabled(false);
                  setResults([]);
                  onSelect(result);
                }}
                style={styles.resultButton}
                type="button"
              >
                {result.label}
              </html.button>
            </html.li>
          ))}
        </html.ul>
      )}
    </html.div>
  );
}
