/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


// Extracted from VS Code c254b82c637ec4ee275483e6e4dcb31360a8b7d7 (MIT).
// Adapted macOS constants and eager Intl; retained computed scores without upstream caches.
type IMatch = { start: number; end: number };
const sep = '/', isLinux = false, isWindows = false;
const equalsIgnoreCase = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isUpper = (c: number) => c >= 65 && c <= 90;
const matchesPrefix = (q: string, t: string) => t.toLowerCase().startsWith(q.toLowerCase()) ? [{start: 0, end: q.length}] : null;
export type FuzzyScore = [number /* score */, number[] /* match positions */];
export type FuzzyScorerCache = { [key: string]: IItemScore };
const NO_MATCH = 0;
const NO_SCORE: FuzzyScore = [NO_MATCH, []];
export function scoreFuzzy(target: string, query: string, queryLower: string, allowNonContiguousMatches: boolean): FuzzyScore {
	if (!target || !query) {
		return NO_SCORE; // return early if target or query are undefined
	}
	const targetLength = target.length;
	const queryLength = query.length;
	if (targetLength < queryLength) {
		return NO_SCORE; // impossible for query to be contained in target
	}
	const targetLower = target.toLowerCase();
	const res = doScoreFuzzy(query, queryLower, queryLength, target, targetLower, targetLength, allowNonContiguousMatches);
	return res;
}
function doScoreFuzzy(query: string, queryLower: string, queryLength: number, target: string, targetLower: string, targetLength: number, allowNonContiguousMatches: boolean): FuzzyScore {
	const scores: number[] = [];
	const matches: number[] = [];
	for (let queryIndex = 0; queryIndex < queryLength; queryIndex++) {
		const queryIndexOffset = queryIndex * targetLength;
		const queryIndexPreviousOffset = queryIndexOffset - targetLength;
		const queryIndexGtNull = queryIndex > 0;
		const queryCharAtIndex = query[queryIndex];
		const queryLowerCharAtIndex = queryLower[queryIndex];
		for (let targetIndex = 0; targetIndex < targetLength; targetIndex++) {
			const targetIndexGtNull = targetIndex > 0;
			const currentIndex = queryIndexOffset + targetIndex;
			const leftIndex = currentIndex - 1;
			const diagIndex = queryIndexPreviousOffset + targetIndex - 1;
			const leftScore = targetIndexGtNull ? scores[leftIndex] : 0;
			const diagScore = queryIndexGtNull && targetIndexGtNull ? scores[diagIndex] : 0;
			const matchesSequenceLength = queryIndexGtNull && targetIndexGtNull ? matches[diagIndex] : 0;
			let score: number;
			if (!diagScore && queryIndexGtNull) {
				score = 0;
			} else {
				score = computeCharScore(queryCharAtIndex, queryLowerCharAtIndex, target, targetLower, targetIndex, matchesSequenceLength);
			}
			const isValidScore = score && diagScore + score >= leftScore;
			if (isValidScore && (
				allowNonContiguousMatches ||
				queryIndexGtNull ||
				targetLower.startsWith(queryLower, targetIndex)
			)) {
				matches[currentIndex] = matchesSequenceLength + 1;
				scores[currentIndex] = diagScore + score;
			}
			else {
				matches[currentIndex] = NO_MATCH;
				scores[currentIndex] = leftScore;
			}
		}
	}
	const positions: number[] = [];
	let queryIndex = queryLength - 1;
	let targetIndex = targetLength - 1;
	while (queryIndex >= 0 && targetIndex >= 0) {
		const currentIndex = queryIndex * targetLength + targetIndex;
		const match = matches[currentIndex];
		if (match === NO_MATCH) {
			targetIndex--; // go left
		} else {
			positions.push(targetIndex);
			queryIndex--;
			targetIndex--;
		}
	}
	return [scores[queryLength * targetLength - 1], positions.reverse()];
}
function computeCharScore(queryCharAtIndex: string, queryLowerCharAtIndex: string, target: string, targetLower: string, targetIndex: number, matchesSequenceLength: number): number {
	let score = 0;
	if (!considerAsEqual(queryLowerCharAtIndex, targetLower[targetIndex])) {
		return score; // no match of characters
	}
	score += 1;
	if (matchesSequenceLength > 0) {
		score += (Math.min(matchesSequenceLength, 3) * 6) + (Math.max(0, matchesSequenceLength - 3) * 3);
	}
	if (queryCharAtIndex === target[targetIndex]) {
		score += 1;
	}
	if (targetIndex === 0) {
		score += 8;
	}
	else {
		const separatorBonus = scoreSeparatorAtPos(target.charCodeAt(targetIndex - 1));
		if (separatorBonus) {
			score += separatorBonus;
		}
		else if (isUpper(target.charCodeAt(targetIndex)) && matchesSequenceLength === 0) {
			score += 2;
		}
	}
	return score;
}
function considerAsEqual(a: string, b: string): boolean {
	if (a === b) {
		return true;
	}
	if (a === '/' || a === '\\') {
		return b === '/' || b === '\\';
	}
	return false;
}
function scoreSeparatorAtPos(charCode: number): number {
	switch (charCode) {
		case 47:
		case 92:
			return 5; // prefer path separators...
		case 95:
		case 45:
		case 46:
		case 32:
		case 39:
		case 34:
		case 58:
			return 4; // ...over other separators
		default:
			return 0;
	}
}
export interface IItemScore {
	/**
	 * Overall score.
	 */
	score: number;
	/**
	 * Matches within the label.
	 */
	labelMatch?: IMatch[];
	/**
	 * Matches within the description.
	 */
	descriptionMatch?: IMatch[];
}
const NO_ITEM_SCORE = Object.freeze<IItemScore>({ score: 0 });
const PATH_IDENTITY_SCORE = 1 << 18;
const LABEL_PREFIX_SCORE_THRESHOLD = 1 << 17;
const LABEL_SCORE_THRESHOLD = 1 << 16;
function doScoreItemFuzzy(label: string, description: string | undefined, path: string | undefined, query: IPreparedQuery, allowNonContiguousMatches: boolean): IItemScore {
	const preferLabelMatches = !path || !query.containsPathSeparator;
	if (path && (isLinux ? query.pathNormalized === path : equalsIgnoreCase(query.pathNormalized, path))) {
		return { score: PATH_IDENTITY_SCORE, labelMatch: [{ start: 0, end: label.length }], descriptionMatch: description ? [{ start: 0, end: description.length }] : undefined };
	}
	if (query.values && query.values.length > 1) {
		return doScoreItemFuzzyMultiple(label, description, path, query.values, preferLabelMatches, allowNonContiguousMatches);
	}
	return doScoreItemFuzzySingle(label, description, path, query, preferLabelMatches, allowNonContiguousMatches);
}
function doScoreItemFuzzyMultiple(label: string, description: string | undefined, path: string | undefined, query: IPreparedQueryPiece[], preferLabelMatches: boolean, allowNonContiguousMatches: boolean): IItemScore {
	let totalScore = 0;
	const totalLabelMatches: IMatch[] = [];
	const totalDescriptionMatches: IMatch[] = [];
	for (const queryPiece of query) {
		const { score, labelMatch, descriptionMatch } = doScoreItemFuzzySingle(label, description, path, queryPiece, preferLabelMatches, allowNonContiguousMatches);
		if (score === NO_MATCH) {
			return NO_ITEM_SCORE;
		}
		totalScore += score;
		if (labelMatch) {
			totalLabelMatches.push(...labelMatch);
		}
		if (descriptionMatch) {
			totalDescriptionMatches.push(...descriptionMatch);
		}
	}
	return {
		score: totalScore,
		labelMatch: normalizeMatches(totalLabelMatches),
		descriptionMatch: normalizeMatches(totalDescriptionMatches)
	};
}
function doScoreItemFuzzySingle(label: string, description: string | undefined, path: string | undefined, query: IPreparedQueryPiece, preferLabelMatches: boolean, allowNonContiguousMatches: boolean): IItemScore {
	if (preferLabelMatches || !description) {
		const [labelScore, labelPositions] = scoreFuzzy(
			label,
			query.normalized,
			query.normalizedLowercase,
			allowNonContiguousMatches && !query.expectContiguousMatch);
		if (labelScore) {
			const labelPrefixMatch = matchesPrefix(query.normalized, label);
			let baseScore: number;
			if (labelPrefixMatch) {
				baseScore = LABEL_PREFIX_SCORE_THRESHOLD;
				const prefixLengthBoost = Math.round((query.normalized.length / label.length) * 100);
				baseScore += prefixLengthBoost;
			} else {
				baseScore = LABEL_SCORE_THRESHOLD;
			}
			return { score: baseScore + labelScore, labelMatch: labelPrefixMatch || createMatches(labelPositions) };
		}
	}
	if (description) {
		let descriptionPrefix = description;
		if (path) {
			descriptionPrefix = `${description}${sep}`; // assume this is a file path
		}
		const descriptionPrefixLength = descriptionPrefix.length;
		const descriptionAndLabel = `${descriptionPrefix}${label}`;
		const [labelDescriptionScore, labelDescriptionPositions] = scoreFuzzy(
			descriptionAndLabel,
			query.normalized,
			query.normalizedLowercase,
			allowNonContiguousMatches && !query.expectContiguousMatch);
		if (labelDescriptionScore) {
			const labelDescriptionMatches = createMatches(labelDescriptionPositions);
			const labelMatch: IMatch[] = [];
			const descriptionMatch: IMatch[] = [];
			labelDescriptionMatches.forEach(h => {
				if (h.start < descriptionPrefixLength && h.end > descriptionPrefixLength) {
					labelMatch.push({ start: 0, end: h.end - descriptionPrefixLength });
					descriptionMatch.push({ start: h.start, end: descriptionPrefixLength });
				}
				else if (h.start >= descriptionPrefixLength) {
					labelMatch.push({ start: h.start - descriptionPrefixLength, end: h.end - descriptionPrefixLength });
				}
				else {
					descriptionMatch.push(h);
				}
			});
			return { score: labelDescriptionScore, labelMatch, descriptionMatch };
		}
	}
	return NO_ITEM_SCORE;
}
function createMatches(offsets: number[] | undefined): IMatch[] {
	const ret: IMatch[] = [];
	if (!offsets) {
		return ret;
	}
	let last: IMatch | undefined;
	for (const pos of offsets) {
		if (last && last.end === pos) {
			last.end += 1;
		} else {
			last = { start: pos, end: pos + 1 };
			ret.push(last);
		}
	}
	return ret;
}
function normalizeMatches(matches: IMatch[]): IMatch[] {
	const sortedMatches = matches.sort((matchA, matchB) => {
		return matchA.start - matchB.start;
	});
	const normalizedMatches: IMatch[] = [];
	let currentMatch: IMatch | undefined = undefined;
	for (const match of sortedMatches) {
		if (!currentMatch || !matchOverlaps(currentMatch, match)) {
			currentMatch = match;
			normalizedMatches.push(match);
		}
		else {
			currentMatch.start = Math.min(currentMatch.start, match.start);
			currentMatch.end = Math.max(currentMatch.end, match.end);
		}
	}
	return normalizedMatches;
}
function matchOverlaps(matchA: IMatch, matchB: IMatch): boolean {
	if (matchA.end < matchB.start) {
		return false;	// A ends before B starts
	}
	if (matchB.end < matchA.start) {
		return false; // B ends before A starts
	}
	return true;
}
export interface IPreparedQueryPiece {
	/**
	 * The original query as provided as input.
	 */
	original: string;
	originalLowercase: string;
	/**
	 * Original normalized to platform separators:
	 * - Windows: \
	 * - Posix: /
	 */
	pathNormalized: string;
	/**
	 * In addition to the normalized path, will have
	 * whitespace, wildcards, quotes, ellipsis, and trailing hash characters removed.
	 */
	normalized: string;
	normalizedLowercase: string;
	/**
	 * The query is wrapped in quotes which means
	 * this query must be a substring of the input.
	 * In other words, no fuzzy matching is used.
	 */
	expectContiguousMatch: boolean;
}
export interface IPreparedQuery extends IPreparedQueryPiece {
	/**
	 * Query split by spaces into pieces.
	 */
	values: IPreparedQueryPiece[] | undefined;
	/**
	 * Whether the query contains path separator(s) or not.
	 */
	containsPathSeparator: boolean;
}
/*
 * If a query is wrapped in quotes, the user does not want to
 * use fuzzy search for this query.
 */
function queryExpectsExactMatch(query: string) {
	return query.startsWith('"') && query.endsWith('"');
}
/**
 * Helper function to prepare a search value for scoring by removing unwanted characters
 * and allowing to score on multiple pieces separated by whitespace character.
 */
const MULTIPLE_QUERY_VALUES_SEPARATOR = ' ';
export function prepareQuery(original: string): IPreparedQuery {
	if (typeof original !== 'string') {
		original = '';
	}
	const originalLowercase = original.toLowerCase();
	const { pathNormalized, normalized, normalizedLowercase } = normalizeQuery(original);
	const containsPathSeparator = pathNormalized.indexOf(sep) >= 0;
	const expectExactMatch = queryExpectsExactMatch(original);
	let values: IPreparedQueryPiece[] | undefined = undefined;
	const originalSplit = original.split(MULTIPLE_QUERY_VALUES_SEPARATOR);
	if (originalSplit.length > 1) {
		for (const originalPiece of originalSplit) {
			const expectExactMatchPiece = queryExpectsExactMatch(originalPiece);
			const {
				pathNormalized: pathNormalizedPiece,
				normalized: normalizedPiece,
				normalizedLowercase: normalizedLowercasePiece
			} = normalizeQuery(originalPiece);
			if (normalizedPiece) {
				if (!values) {
					values = [];
				}
				values.push({
					original: originalPiece,
					originalLowercase: originalPiece.toLowerCase(),
					pathNormalized: pathNormalizedPiece,
					normalized: normalizedPiece,
					normalizedLowercase: normalizedLowercasePiece,
					expectContiguousMatch: expectExactMatchPiece
				});
			}
		}
	}
	return { original, originalLowercase, pathNormalized, normalized, normalizedLowercase, values, containsPathSeparator, expectContiguousMatch: expectExactMatch };
}
function normalizeQuery(original: string): { pathNormalized: string; normalized: string; normalizedLowercase: string } {
	let pathNormalized: string;
	if (isWindows) {
		pathNormalized = original.replace(/\//g, sep); // Help Windows users to search for paths when using slash
	} else {
		pathNormalized = original.replace(/\\/g, sep); // Help macOS/Linux users to search for paths when using backslash
	}
	const normalized = pathNormalized.replace(/[*\u2026\s"]/g, '').replace(/(?<=.)#$/, '');
	return {
		pathNormalized,
		normalized,
		normalizedLowercase: normalized.toLowerCase()
	};
}

export function scorePath(path: string, input: string) {
  if (!input.trim() || input.length > 256 || path.length > 4096) return;
  const index = path.lastIndexOf('/'), label = path.slice(index + 1);
  const result = doScoreItemFuzzy(label, index < 0 ? undefined : path.slice(0, index), path, prepareQuery(input), true);
  if (!result.score) return;
  const positions = new Set<number>();
  for (const range of result.descriptionMatch ?? []) for (let i = range.start; i < range.end; i++) positions.add(i);
  for (const range of result.labelMatch ?? []) for (let i = range.start; i < range.end; i++) positions.add(index + 1 + i);
  return { itemScore: result, score: result.score, positions: [...positions].sort((a,b) => a-b) };
}

export interface IItemAccessor<T> {

	/**
	 * Just the label of the item to score on.
	 */
	getItemLabel(item: T): string | undefined;

	/**
	 * The optional description of the item to score on.
	 */
	getItemDescription(item: T): string | undefined;

	/**
	 * If the item is a file, the path of the file to score on.
	 */
	getItemPath(file: T): string | undefined;
}

export type RankedPath = NonNullable<ReturnType<typeof scorePath>> & { path: string };
type LookupPath = { path: string; score: number; positions: readonly number[]; itemScore?: IItemScore };
const pathAccessor: IItemAccessor<LookupPath> = {
 getItemLabel: item => item.path.slice(item.path.lastIndexOf('/') + 1),
 getItemDescription: item => item.path.includes('/') ? item.path.slice(0,item.path.lastIndexOf('/')) : undefined,
 getItemPath: item => item.path,
};
// Wire rows retain enough positions to reuse the same comparator without rescoring.
function lookupItemScore(item: LookupPath): IItemScore {
  if (item.itemScore) return item.itemScore;
  const offset = item.path.lastIndexOf('/') + 1;
  const labelMatch: IMatch[] = [], descriptionMatch: IMatch[] = [];
  for (const position of item.positions) {
    const ranges = position >= offset ? labelMatch : descriptionMatch;
    const start = position >= offset ? position - offset : position;
    const previous = ranges.at(-1);
    if (previous?.end === start) previous.end++;
    else ranges.push({ start, end: start + 1 });
  }
  return { score: item.score, labelMatch, descriptionMatch };
}
export function comparePathScores(itemA: LookupPath, itemB: LookupPath, input: string): number {
	const query = prepareQuery(input), accessor = pathAccessor;
	const itemScoreA = lookupItemScore(itemA);
	const itemScoreB = lookupItemScore(itemB);

	const scoreA = itemScoreA.score;
	const scoreB = itemScoreB.score;

	if (scoreA === PATH_IDENTITY_SCORE || scoreB === PATH_IDENTITY_SCORE) {
		if (scoreA !== scoreB) {
			return scoreA === PATH_IDENTITY_SCORE ? -1 : 1;
		}
	}

	if (scoreA > LABEL_SCORE_THRESHOLD || scoreB > LABEL_SCORE_THRESHOLD) {
		if (scoreA !== scoreB) {
			return scoreA > scoreB ? -1 : 1;
		}


		if (scoreA < LABEL_PREFIX_SCORE_THRESHOLD && scoreB < LABEL_PREFIX_SCORE_THRESHOLD) {
			const comparedByMatchLength = compareByMatchLength(itemScoreA.labelMatch, itemScoreB.labelMatch);
			if (comparedByMatchLength !== 0) {
				return comparedByMatchLength;
			}
		}

		const labelA = accessor.getItemLabel(itemA) || '';
		const labelB = accessor.getItemLabel(itemB) || '';
		if (labelA.length !== labelB.length) {
			return labelA.length - labelB.length;
		}
	}

	if (scoreA !== scoreB) {
		return scoreA > scoreB ? -1 : 1;
	}

	const itemAHasLabelMatches = Array.isArray(itemScoreA.labelMatch) && itemScoreA.labelMatch.length > 0;
	const itemBHasLabelMatches = Array.isArray(itemScoreB.labelMatch) && itemScoreB.labelMatch.length > 0;
	if (itemAHasLabelMatches && !itemBHasLabelMatches) {
		return -1;
	} else if (itemBHasLabelMatches && !itemAHasLabelMatches) {
		return 1;
	}

	const itemAMatchDistance = computeLabelAndDescriptionMatchDistance(itemA, itemScoreA, accessor);
	const itemBMatchDistance = computeLabelAndDescriptionMatchDistance(itemB, itemScoreB, accessor);
	if (itemAMatchDistance && itemBMatchDistance && itemAMatchDistance !== itemBMatchDistance) {
		return itemBMatchDistance > itemAMatchDistance ? -1 : 1;
	}

	return fallbackCompare(itemA, itemB, query, accessor);
}

function computeLabelAndDescriptionMatchDistance<T>(item: T, score: IItemScore, accessor: IItemAccessor<T>): number {
	let matchStart = -1;
	let matchEnd = -1;

	if (score.descriptionMatch?.length) {
		matchStart = score.descriptionMatch[0].start;
	}

	else if (score.labelMatch?.length) {
		matchStart = score.labelMatch[0].start;
	}



	if (score.labelMatch?.length) {
		matchEnd = score.labelMatch[score.labelMatch.length - 1].end;
		if (score.descriptionMatch?.length) {
			const itemDescription = accessor.getItemDescription(item);
			if (itemDescription) {
				matchEnd += itemDescription.length;
			}
		}
	}

	else if (score.descriptionMatch?.length) {
		matchEnd = score.descriptionMatch[score.descriptionMatch.length - 1].end;
	}

	return matchEnd - matchStart;
}

function compareByMatchLength(matchesA?: IMatch[], matchesB?: IMatch[]): number {
	if ((!matchesA && !matchesB) || ((!matchesA?.length) && (!matchesB?.length))) {
		return 0; // make sure to not cause bad comparing when matches are not provided
	}

	if (!matchesB?.length) {
		return -1;
	}

	if (!matchesA?.length) {
		return 1;
	}

	const matchStartA = matchesA[0].start;
	const matchEndA = matchesA[matchesA.length - 1].end;
	const matchLengthA = matchEndA - matchStartA;

	const matchStartB = matchesB[0].start;
	const matchEndB = matchesB[matchesB.length - 1].end;
	const matchLengthB = matchEndB - matchStartB;

	return matchLengthA === matchLengthB ? 0 : matchLengthB < matchLengthA ? 1 : -1;
}

function fallbackCompare<T>(itemA: T, itemB: T, query: IPreparedQuery, accessor: IItemAccessor<T>): number {

	const labelA = accessor.getItemLabel(itemA) || '';
	const labelB = accessor.getItemLabel(itemB) || '';

	const descriptionA = accessor.getItemDescription(itemA);
	const descriptionB = accessor.getItemDescription(itemB);

	const labelDescriptionALength = labelA.length + (descriptionA ? descriptionA.length : 0);
	const labelDescriptionBLength = labelB.length + (descriptionB ? descriptionB.length : 0);

	if (labelDescriptionALength !== labelDescriptionBLength) {
		return labelDescriptionALength - labelDescriptionBLength;
	}

	const pathA = accessor.getItemPath(itemA);
	const pathB = accessor.getItemPath(itemB);

	if (pathA && pathB && pathA.length !== pathB.length) {
		return pathA.length - pathB.length;
	}


	if (labelA !== labelB) {
		return compareAnything(labelA, labelB, query.normalized);
	}

	if (descriptionA && descriptionB && descriptionA !== descriptionB) {
		return compareAnything(descriptionA, descriptionB, query.normalized);
	}

	if (pathA && pathB && pathA !== pathB) {
		return compareAnything(pathA, pathB, query.normalized);
	}

	return 0;
}


const fileCollator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
function compareFileNames(a: string, b: string) { const result = fileCollator.compare(a,b); return result === 0 && a !== b ? a < b ? -1 : 1 : result; }
export function compareAnything(one: string, other: string, lookFor: string): number {
	const elementAName = one.toLowerCase();
	const elementBName = other.toLowerCase();

	const prefixCompare = compareByPrefix(one, other, lookFor);
	if (prefixCompare) {
		return prefixCompare;
	}

	const elementASuffixMatch = elementAName.endsWith(lookFor);
	const elementBSuffixMatch = elementBName.endsWith(lookFor);
	if (elementASuffixMatch !== elementBSuffixMatch) {
		return elementASuffixMatch ? -1 : 1;
	}

	const r = compareFileNames(elementAName, elementBName);
	if (r !== 0) {
		return r;
	}

	return elementAName.localeCompare(elementBName);
}

export function compareByPrefix(one: string, other: string, lookFor: string): number {
	const elementAName = one.toLowerCase();
	const elementBName = other.toLowerCase();

	const elementAPrefixMatch = elementAName.startsWith(lookFor);
	const elementBPrefixMatch = elementBName.startsWith(lookFor);
	if (elementAPrefixMatch !== elementBPrefixMatch) {
		return elementAPrefixMatch ? -1 : 1;
	}

	else if (elementAPrefixMatch && elementBPrefixMatch) {
		if (elementAName.length < elementBName.length) {
			return -1;
		}

		if (elementAName.length > elementBName.length) {
			return 1;
		}
	}

	return 0;
}