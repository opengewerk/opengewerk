import type { RecordState, WithdrawalVariant } from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { SelectField } from '../../components/index.js'
import { useMay } from '../../app/queries.js'
import {
  chooseInstructions,
  type DocumentInstructions,
  documentInstructions,
  type InstructionChoice,
  instructionSheetAddress,
  type PrintedInstruction,
} from '../../session/instructions.js'
import { maybeText } from '../../sync/fields.js'
import { RequestRefused } from '../../sync/transport.js'
import { Nothing, Section } from '../layout.js'

const variantOptions: readonly { readonly value: WithdrawalVariant; readonly label: string }[] = [
  { value: 'service', label: 'Arbeiten, also eine Dienstleistung' },
  { value: 'goods', label: 'Lieferung von Waren mit Montage' },
]

/** A link that opens a sheet of its own, the way the head of the page opens the PDF. */
function SheetLink({
  documentId,
  instruction,
}: {
  readonly documentId: string
  readonly instruction: PrintedInstruction
}) {
  return (
    <a
      href={instructionSheetAddress(documentId, instruction.index)}
      target="_blank"
      rel="noopener noreferrer"
      className="text-table font-semibold text-copper-text underline underline-offset-2"
      aria-label={`${instruction.title} als eigenes Blatt öffnen`}
    >
      Als Blatt öffnen
    </a>
  )
}

/** Where an instruction goes, in the words of the screen; in the past once it went. */
function whereItGoes(withDocument: boolean, went: boolean): string {
  if (withDocument) {
    return went
      ? 'Ist mit dem Beleg hinausgegangen, im PDF nach dem Beleg.'
      : 'Geht mit dem Beleg hinaus, im PDF nach dem Beleg und in der E-Mail.'
  }

  return 'Liegt als eigenes Blatt zum Ausdrucken bereit.'
}

/** One instruction on a draft, with its switch. */
function Choice({
  choice,
  printed,
  documentId,
  editable,
  working,
  onSwitch,
}: {
  readonly choice: InstructionChoice
  readonly printed: PrintedInstruction | undefined
  readonly documentId: string
  readonly editable: boolean
  readonly working: boolean
  readonly onSwitch: (included: boolean) => void
}) {
  return (
    <li className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-body font-semibold">
        <input
          type="checkbox"
          className="size-5"
          checked={choice.included}
          disabled={!editable || working || choice.required}
          onChange={(event) => {
            onSwitch(event.target.checked)
          }}
        />
        {choice.title}
      </label>
      {choice.included ? (
        <p className="pl-7 text-table text-ink-muted">
          {choice.required ? 'Pflicht an jedem Angebot an einen Verbraucher. ' : ''}
          {whereItGoes(choice.withDocument, false)}
          {choice.proposed || choice.required
            ? ''
            : ' Für diesen Beleg nicht vorgeschlagen, von Hand dazugenommen.'}
          {choice.changed ? ' Der Betrieb hat den Wortlaut geändert.' : ''}
        </p>
      ) : null}
      {choice.included && printed && !printed.withDocument ? (
        <p className="pl-7">
          <SheetLink documentId={documentId} instruction={printed} />
        </p>
      ) : null}
    </li>
  )
}

/**
 * The instructions of a document, #109: which of them go with it, filled in
 * for which kind of contract, and what is still missing for them.
 *
 * On a draft the office switches each one on or off, because whether a
 * contract comes about at the customer's home or at a distance is something
 * the software cannot know; the proposal comes from the kind of document and
 * the customer. Once the document is issued, the section shows what went out
 * with it, frozen, and each as a sheet to open.
 *
 * Read from the server, like the PDF: the instructions of the business live
 * there, and a device that has none offline shows why.
 */
export function InstructionsSection({ document }: { readonly document: RecordState }) {
  const documentId = String(document['id'])
  const queries = useQueryClient()
  const mayWrite = useMay('document.write')
  // The proposal hangs on the customer, the kind and the date, and what goes
  // out is frozen by issuing: asked again when any of them changes.
  const queryKey = [
    'document-instructions',
    documentId,
    maybeText(document, 'status'),
    maybeText(document, 'customerId'),
    maybeText(document, 'kind'),
    maybeText(document, 'documentDate'),
  ]
  const view = useQuery({ queryKey, queryFn: () => documentInstructions(documentId) })
  const choose = useMutation({
    mutationFn: (choice: Parameters<typeof chooseInstructions>[1]) =>
      chooseInstructions(documentId, choice),
    onSuccess: (next: DocumentInstructions) => {
      queries.setQueryData(queryKey, next)
    },
  })

  if (view.isPending) {
    return null
  }

  if (view.isError) {
    return (
      <Section title="Belehrungen">
        <Nothing>
          {view.error instanceof RequestRefused
            ? view.error.message
            : 'Die Belehrungen liegen auf dem Server und brauchen eine Verbindung.'}
        </Nothing>
      </Section>
    )
  }

  const { fixed, variant, choices, printed, gaps } = view.data

  if (fixed && printed.length === 0) {
    return null
  }

  const editable = !fixed && mayWrite
  const status = maybeText(document, 'status')
  const went = status === 'issued' || status === 'cancelled'
  const included = choices.filter((choice) => choice.included || choice.proposed)
  const others = choices.filter((choice) => !choice.included && !choice.proposed)
  const dependsOnContract = choices.some(
    (choice) => choice.included && choice.template === 'withdrawal',
  )
  const printedByTitle = (title: string) => printed.find((entry) => entry.title === title)
  const trouble =
    choose.error instanceof RequestRefused
      ? choose.error.message
      : choose.error
        ? 'Keine Verbindung. Belehrungen werden mit Verbindung gewählt.'
        : null

  return (
    <Section title="Belehrungen">
      <div className="flex flex-col gap-4">
        {fixed ? (
          <ul className="flex flex-col gap-3">
            {printed.map((instruction) => (
              <li key={instruction.index} className="flex flex-col gap-1">
                <span className="text-body font-semibold">{instruction.title}</span>
                <span className="text-table text-ink-muted">
                  {whereItGoes(instruction.withDocument, went)}
                  {instruction.changed ? ' Mit geändertem Wortlaut des Musters.' : ''}
                </span>
                <span>
                  <SheetLink documentId={documentId} instruction={instruction} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            {included.length === 0 ? (
              <p className="text-body text-ink-muted">
                Zu diesem Beleg ist keine Belehrung vorgeschlagen.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {included.map((choice) => (
                  <Choice
                    key={choice.id}
                    choice={choice}
                    printed={printedByTitle(choice.title)}
                    documentId={documentId}
                    editable={editable}
                    working={choose.isPending}
                    onSwitch={(on) => {
                      choose.mutate({ instructionId: choice.id, included: on })
                    }}
                  />
                ))}
              </ul>
            )}

            {dependsOnContract ? (
              <SelectField
                label="Der Vertrag betrifft"
                value={variant}
                options={variantOptions}
                disabled={!editable || choose.isPending}
                hint="Davon hängt ab, wann die Widerrufsfrist beginnt und was bei einem Widerruf mit Arbeit oder Waren geschieht."
                onChange={(value) => {
                  choose.mutate({ variant: value as WithdrawalVariant })
                }}
              />
            ) : null}

            {others.length > 0 && editable ? (
              <details>
                <summary className="cursor-pointer text-body font-semibold">
                  Weitere Belehrungen
                </summary>
                <ul className="mt-3 flex flex-col gap-3">
                  {others.map((choice) => (
                    <Choice
                      key={choice.id}
                      choice={choice}
                      printed={undefined}
                      documentId={documentId}
                      editable={editable}
                      working={choose.isPending}
                      onSwitch={(on) => {
                        choose.mutate({ instructionId: choice.id, included: on })
                      }}
                    />
                  ))}
                </ul>
              </details>
            ) : null}

            {gaps.length > 0 ? (
              <div role="note" className="rounded-control border border-conflict p-3 text-body">
                <p className="font-semibold text-conflict">Vor dem Festschreiben fehlt noch</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {gaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}

        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
    </Section>
  )
}
