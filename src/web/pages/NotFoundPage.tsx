import { SearchX } from 'lucide-react';
import { Link } from 'react-router';
import { useT } from '../i18n';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { paths } from '../paths';
import { Notice } from '../ui/states';
import { Page } from './Page';

export function NotFoundPage() {
  const text = useT().shell.notFound;
  useDocumentTitle(text.title);
  return (
    <Page title={text.title}>
      <Notice
        icon={SearchX}
        title={text.notice}
        action={
          <Link to={paths.global()} className="font-medium text-accent hover:underline">
            {text.back}
          </Link>
        }
      >
        {text.hintBefore}
        <code>{text.hintPath}</code>
        {text.hintAfter}
      </Notice>
    </Page>
  );
}
