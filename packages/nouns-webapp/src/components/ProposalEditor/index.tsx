import { useEffect, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { FormControl, FormText, InputGroup } from 'react-bootstrap';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import classes from './ProposalEditor.module.css';

const bodyPlaceholder = `## Summary\n\nInsert your summary here\n\n## Methodology\n\nInsert your methodology here\n\n## Conclusion\n\nInsert your conclusion here`;

const ProposalEditor = ({
  title,
  body,
  onTitleInput,
  onBodyInput,
  isCandidate = false,
  layout = 'stacked',
}: {
  title: string;
  body: string;
  onTitleInput: (title: string) => void;
  onBodyInput: (body: string) => void;
  isCandidate?: boolean;
  /**
   * `stacked` (default) keeps the preview under the textarea and only shows it
   * once there is text — the behaviour every proposal/candidate form relies
   * on. `split` puts editor and preview side by side and always shows the
   * preview; used by the draft mini-window, where a long pasted proposal
   * needs the width.
   */
  layout?: 'stacked' | 'split';
}) => {
  const [proposalText, setProposalText] = useState('');

  const onBodyChange = (body: string) => {
    setProposalText(body);
    onBodyInput(body);
  };

  useEffect(() => {
    setProposalText(body);
  }, [body]);

  const titleField = (
    <>
      <FormText>{isCandidate ? <Trans>Candidate</Trans> : <Trans>Proposal</Trans>}</FormText>
      <FormControl
        className={classes.titleInput}
        value={title}
        onChange={e => onTitleInput(e.target.value)}
        placeholder={isCandidate ? 'Proposal candidate title' : 'Proposal title'}
      />
    </>
  );

  const bodyField = (extraClass = '') => (
    <FormControl
      className={`${classes.bodyInput} ${extraClass}`}
      value={body}
      onChange={e => onBodyChange(e.target.value)}
      as="textarea"
      placeholder={bodyPlaceholder}
    />
  );

  // The global `proposal-preview` / `proposal-markdown` hooks let index.css
  // style the rendered markdown (tables, lists, code) without reaching into
  // hashed CSS-module class names.
  const preview = (
    <div className={`${classes.previewArea} proposal-preview`}>
      <h3>
        <Trans>Preview</Trans>
      </h3>
      {title && (
        <>
          <h1 className={classes.propTitle}>{title}</h1>
          <hr />
        </>
      )}
      {proposalText !== '' ? (
        <ReactMarkdown
          className={`${classes.markdown} proposal-markdown`}
          remarkPlugins={[remarkGfm, remarkBreaks]}
          rehypePlugins={[rehypeRaw]}
        >
          {proposalText}
        </ReactMarkdown>
      ) : (
        <p className={classes.previewEmpty}>Start typing — the rendered proposal appears here.</p>
      )}
    </div>
  );

  if (layout === 'split') {
    return (
      <div className={classes.split}>
        <div className={`${classes.proposalEditor} ${classes.splitTitle}`}>{titleField}</div>
        <div className={`${classes.proposalEditor} ${classes.splitPane}`}>
          {bodyField(classes.splitBody)}
        </div>
        <div className={classes.splitPane}>{preview}</div>
      </div>
    );
  }

  return (
    <div>
      <InputGroup className={`${classes.proposalEditor} d-flex flex-column`}>
        {titleField}
        <hr className={classes.divider} />
        {bodyField()}
      </InputGroup>
      {proposalText !== '' && preview}
    </div>
  );
};
export default ProposalEditor;
