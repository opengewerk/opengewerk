import type { RecordState, WithdrawalVariant } from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useId } from 'react'
import type { ReactNode } from 'react'

import { Panel, SelectField } from '../../components/index.js'
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
import { NoteBox } from '../kit.js'

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
      className="text-copper-text underline underline-offset-2"
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

/**
 * One instruction as the board draws it, `checkbox()` of the canvas: the box,
 * the name beside it, and under the name in smaller type where it goes. What
 * stands under the name describes the box and is not part of its name, so the
 * box is called what the instruction is called.
 */
function InstructionRow({
  title,
  box,
  children,
}: {
  readonly title: string
  /** The box, or nothing where an instruction only stands there, on a fixed document. */
  readonly box?: (ids: { readonly box: string; readonly note: string }) => ReactNode
  readonly children: ReactNode
}) {
  const ids = { box: useId(), note: useId() }

  return (
    <li className="flex items-start gap-[9px]">
      {box ? box(ids) : null}
      <div className="min-w-0 text-[14px] leading-[1.4] text-ink">
        {box ? <label htmlFor={ids.box}>{title}</label> : <span>{title}</span>}
        {children ? (
          <span id={ids.note} className="block text-[13px] text-ink-muted">
            {children}
          </span>
        ) : null}
      </div>
    </li>
  )
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
    <InstructionRow
      title={choice.title}
      box={(ids) => (
        <input
          id={ids.box}
          type="checkbox"
          aria-describedby={choice.included ? ids.note : undefined}
          className="mt-0.5 size-4 shrink-0 accent-copper-solid max-lg:size-5"
          checked={choice.included}
          disabled={!editable || working || choice.required}
          onChange={(event) => {
            onSwitch(event.target.checked)
          }}
        />
      )}
    >
      {choice.included ? (
        <>
          {choice.required ? 'Pflicht an jedem Angebot an einen Verbraucher. ' : ''}
          {whereItGoes(choice.withDocument, false)}
          {choice.proposed || choice.required
            ? ''
            : ' Für diesen Beleg nicht vorgeschlagen, von Hand dazugenommen.'}
          {choice.changed ? ' Der Betrieb hat den Wortlaut geändert.' : ''}
          {printed && !printed.withDocument ? (
            <>
              {' '}
              <SheetLink documentId={documentId} instruction={printed} />
            </>
          ) : null}
        </>
      ) : null}
    </InstructionRow>
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
export function InstructionsCard({ document }: { readonly document: RecordState }) {
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
      <Panel title="Belehrungen">
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          {view.error instanceof RequestRefused
            ? view.error.message
            : 'Die Belehrungen liegen auf dem Server und brauchen eine Verbindung.'}
        </p>
      </Panel>
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
    <Panel title="Belehrungen">
      <div className="flex flex-col gap-2.5">
        {fixed ? (
          <ul className="flex flex-col gap-2.5">
            {printed.map((instruction) => (
              <InstructionRow key={instruction.index} title={instruction.title}>
                {whereItGoes(instruction.withDocument, went)}
                {instruction.changed ? ' Mit geändertem Wortlaut des Musters.' : ''}{' '}
                <SheetLink documentId={documentId} instruction={instruction} />
              </InstructionRow>
            ))}
          </ul>
        ) : (
          <>
            {included.length === 0 ? (
              <p className="text-[13px] leading-[1.4] text-ink-muted">
                Zu diesem Beleg ist keine Belehrung vorgeschlagen.
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
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
              <div className="grid gap-3 sm:grid-cols-2">
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
              </div>
            ) : null}

            {others.length > 0 && editable ? (
              <details>
                <summary className="cursor-pointer text-[14px] font-semibold">
                  Weitere Belehrungen
                </summary>
                <ul className="mt-2.5 flex flex-col gap-2.5">
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
              <div role="note">
                <NoteBox tone="conflict" icon={TriangleAlert}>
                  <span className="font-semibold">Vor dem Festschreiben fehlt noch:</span>
                  <ul className="mt-1 flex flex-col gap-1">
                    {gaps.map((gap) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                </NoteBox>
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
    </Panel>
  )
}
