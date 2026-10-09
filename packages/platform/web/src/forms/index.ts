/**
 * The blocks a form is drawn with on site, one for each kind of field the
 * engine of `@opengewerk/platform-domain` knows beyond plain inputs: the
 * check point, the measured value with its limit, the figure with its unit
 * and the reading of a meter, the remark or reason under an answer, the photo
 * of a point, and the answer and progress a list of points shows. They hold
 * no form and no record: what an answer is stored as, and which kinds a form
 * of the application has, is the application's. Text, choice and yes or no
 * are `Field`, `TextArea` and `Choice` at the root.
 */

export { newBlockKey } from './block-key.js'
export { AnswerMark, AnswerProgress } from './answer-mark.js'
export type { PointState } from './answer-mark.js'
export { CheckPointAnswer, checkPointWords } from './check-point.js'
export type { CheckPointAnswerProps } from './check-point.js'
export { FigureInput } from './figure.js'
export type { FigureInputProps, FigureTone } from './figure.js'
export { limitMark, MeasurementBlock, verdictText } from './measurement.js'
export type { MeasurementBlockProps } from './measurement.js'
export { FigureBlock } from './figure-block.js'
export type { FigureBlockProps, FigureDoubt } from './figure-block.js'
export { PhotoTaker } from './photo.js'
export type { PhotoTakerProps } from './photo.js'
export { remarkForCheckPoint, remarkForMeasurement, RemarkField } from './remark.js'
export type { RemarkAsked, RemarkFieldProps } from './remark.js'
