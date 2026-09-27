import { useMemo, type ReactNode } from 'react';
// Not expo-linking: on web it would open links in place of the app, where this opens a new tab.
import { Linking, Text, View, type TextStyle } from 'react-native';
import { Renderer, useMarkdown, type MarkedStyles, type RendererInterface } from 'react-native-marked';
import { Spacing, useTheme, type Theme } from '@/constants/theme';
import { CodeBlock, MONOSPACE } from './CodeBlock';

// Replies are written by a model, so only these kinds of links open.
const SAFE_LINK = /^(https?:|mailto:|tel:)/i;
const CARET = '▍';

function openLink(href: string) {
  if (SAFE_LINK.test(href)) Linking.openURL(href).catch(() => undefined);
}

class ChatRenderer extends Renderer implements RendererInterface {
  private readonly colors: Theme;

  // A renderer per text restarts its element keys, so finished blocks keep theirs while the text streams in.
  // Taking the text here, unused, also makes React Compiler build a new renderer whenever the text changes.
  constructor(colors: Theme, _source: string) {
    super({ selectable: true });
    this.colors = colors;
  }

  override link(children: string | ReactNode[], href: string, styles?: TextStyle): ReactNode {
    return (
      <Text key={this.getKey()} accessibilityRole="link" selectable style={styles} onPress={() => openLink(href)}>
        {children}
      </Text>
    );
  }

  override code(text: string, language?: string): ReactNode {
    return <CodeBlock key={this.getKey()} code={text} language={language} />;
  }

  // Remote images aren't loaded: the description stands in for them, as a link.
  override image(uri: string, alt?: string): ReactNode {
    return this.link(alt || uri, uri, this.linkStyle());
  }

  override linkImage(href: string, _imageUrl: string, alt?: string): ReactNode {
    return this.link(alt || href, href, this.linkStyle());
  }

  private linkStyle(): TextStyle {
    return { color: this.colors.accent, textDecorationLine: 'underline' };
  }
}

function markdownStyles(theme: Theme): MarkedStyles {
  // No fontWeight here: the renderer lays these under bold and headings, and would undo them.
  const body: TextStyle = { color: theme.text, fontSize: 16, lineHeight: 24 };
  const heading = (fontSize: number, lineHeight: number): TextStyle => ({
    color: theme.text,
    fontSize,
    lineHeight,
    fontWeight: '700',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
    paddingBottom: 0,
    borderBottomWidth: 0,
  });
  return {
    text: body,
    li: body,
    paragraph: { paddingVertical: 6 },
    strong: { ...body, fontWeight: '700' },
    em: { ...body, fontStyle: 'italic' },
    strikethrough: { ...body, textDecorationLine: 'line-through' },
    link: { ...body, color: theme.accent, fontStyle: 'normal', textDecorationLine: 'underline' },
    h1: heading(22, 30),
    h2: heading(20, 28),
    h3: heading(18, 26),
    h4: heading(17, 24),
    h5: heading(16, 24),
    h6: heading(16, 24),
    codespan: { fontFamily: MONOSPACE, fontStyle: 'normal', fontWeight: '400', fontSize: 14, color: theme.text, backgroundColor: theme.surfaceMuted },
    blockquote: { borderLeftColor: theme.border, borderLeftWidth: 3, paddingLeft: Spacing.md, opacity: 1 },
    hr: { borderBottomColor: theme.border, marginVertical: Spacing.md },
    table: { borderColor: theme.border },
    tableCell: { padding: 6 },
  };
}

/** Markdown from the assistant, themed and selectable. While `streaming`, a caret marks where text is arriving. */
export function Markdown({ value, streaming }: { value: string; streaming: boolean }) {
  const theme = useTheme();
  const source = streaming ? `${value.trimEnd()} ${CARET}` : value;
  const styles = useMemo(() => markdownStyles(theme), [theme]);
  const colors = useMemo(() => ({ colors: { text: theme.text, link: theme.accent, code: theme.surfaceMuted, border: theme.border } }), [theme]);
  const renderer = useMemo(() => new ChatRenderer(theme, source), [theme, source]);
  const elements = useMarkdown(source, { styles, theme: colors, renderer });
  return <View>{elements}</View>;
}
