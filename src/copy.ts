export const allowConfirmedCopy = (
  event: Event,
  confirmCopy: () => boolean,
): boolean => {
  const confirmed = confirmCopy();
  if (!confirmed) event.preventDefault();
  return confirmed;
};

type CopyField = EventTarget & { readonly value: string };

type CopyRoute<Output extends CopyField, Feedback> = Readonly<{
  button: EventTarget;
  output: Output;
  feedback: Feedback;
}>;

type CopyControls<Output extends CopyField, Feedback> = Readonly<{
  private: CopyRoute<Output, Feedback>;
  bitcoin: CopyRoute<Output, Feedback>;
  ethereum: CopyRoute<Output, Feedback>;
}>;

type CopyActions<Output extends CopyField, Feedback> = Readonly<{
  confirmPrivateCopy: () => boolean;
  copy: (
    output: Output,
    feedback: Feedback,
    privateCopyConfirmed?: boolean,
  ) => void | Promise<void>;
  isPrivateCopyApproved: () => boolean;
  privateCopyCancelled: (feedback: Feedback) => void;
}>;

export const bindCopyControls = <Output extends CopyField, Feedback>(
  controls: CopyControls<Output, Feedback>,
  actions: CopyActions<Output, Feedback>,
) => {
  controls.private.output.addEventListener("copy", (event) => {
    if (actions.isPrivateCopyApproved()) return;
    if (!allowConfirmedCopy(event, actions.confirmPrivateCopy)) {
      actions.privateCopyCancelled(controls.private.feedback);
    }
  });

  controls.private.button.addEventListener("click", () => {
    if (!controls.private.output.value) return;
    if (!actions.confirmPrivateCopy()) {
      actions.privateCopyCancelled(controls.private.feedback);
      return;
    }
    void actions.copy(controls.private.output, controls.private.feedback, true);
  });

  for (const route of [controls.bitcoin, controls.ethereum]) {
    route.button.addEventListener("click", () => {
      void actions.copy(route.output, route.feedback);
    });
  }
};
