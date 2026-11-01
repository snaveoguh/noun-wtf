import { Trans } from '@lingui/react/macro';

import _404img from '../../assets/404noun.png';
import Section from '../../layout/Section';

import classes from './NotFound.module.css';

// Laid out from the page container, not the viewport: the image stacks over
// the heading below lg (760) and sits beside it (1 : 2, as before) from lg up.
const NotFoundPage = () => {
  return (
    <Section fullWidth={false}>
      <div className="@lg:grid-cols-[1fr_2fr] @lg:gap-6 grid items-center gap-4">
        <img src={_404img} alt="" className="@lg:max-w-none mx-auto block h-auto w-full max-w-xs" />
        <h1 className={classes.heading}>
          <Trans>404: This is not the person, place, or thing you&apos;re looking for...</Trans>
        </h1>
      </div>
    </Section>
  );
};
export default NotFoundPage;
