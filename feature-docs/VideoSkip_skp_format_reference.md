# VideoSkip `.skp` File Format Reference

This document describes the human-editable `.skp` skip-list format used by **VideoSkip**, based on the project’s public repository materials and in-app help.

## Overview

A `.skp` file is a plain-text file that defines:

- optional header / metadata lines
- one or more **skip entries**
- optional disabled entries
- optional blur-region data for selected entries

In practice, the main structure is a repeating pattern of **two lines per skip entry**:

1. a **time range line**
2. a **label / behavior line**

Some entries may also include extra data such as screenshot or blur-region information.

## Basic skip-entry structure

A normal skip block looks like this:

```text
00:01:23.456 - 00:01:28.900
Profanity mute 3
```

That means:

- start time: `00:01:23.456`
- end time: `00:01:28.900`
- label / action text: `Profanity mute`
- rating / severity: `3`

## Time range line

The first line of an entry is the time interval.

General form:

```text
HH:MM:SS.mmm - HH:MM:SS.mmm
```

Examples:

```text
00:10:05.120 - 00:10:07.850
01:02:03.004 - 01:02:10.000
```

### Notes

- Times are written in hour-minute-second form.
- Milliseconds are included.
- The separator is a spaced hyphen: ` - `

## Label / behavior line

The second line contains the category / description plus any handling keyword and rating.

Example:

```text
Violence skip 3
```

From the public help text, this line can include:

- a free-text label/category
- a handling mode such as `skip` or `mute`
- a numeric rating

## Recognized handling modes

The project documentation indicates these action types are used on entries:

- `skip`
- `mute`

Examples:

```text
Profanity mute 3
Violence skip 3
```

## Ratings / severity

A trailing number is used as the rating / severity for the segment.

Example:

```text
Nudity skip 3
```

Based on the public materials reviewed, the supported severity scale is **1 to 3**, where **3 is the maximum severity**.

Practical interpretation:

- `1` = mild
- `2` = moderate
- `3` = severe

So the label/action line typically ends in an integer from `1` to `3`.

## Disabled entries

VideoSkip documentation indicates you can disable an entry by prefixing lines with `//`.

Example:

```text
//00:15:00.000 - 00:15:08.000
//Violence skip 3
```

This keeps the block in the file without actively using it.

## Example with multiple entries

```text
00:03:11.250 - 00:03:13.800
Profanity mute 3

00:07:42.100 - 00:07:49.000
Violence skip 3

//00:12:05.000 - 00:12:08.500
//Crude joke mute 2
```

## Blur-region notation

The public VideoSkip materials mention that blur regions can also be saved as part of the skip list.

That means a segment may contain additional data beyond the basic two-line structure when blur masking is used.

However, from the public materials I reviewed, I could not fully verify the exact serialized text layout for blur-region lines in all cases, so any implementation that needs perfect compatibility should confirm against the current source code.

## Screenshot data

The project also indicates that screenshot data may be saved with the skip list.

I could confirm that screenshots are conceptually associated with skip entries, but I could **not fully verify the exact on-disk text serialization format** for that data from the public materials I reviewed.

## Practical parsing guidance

If you want to parse a typical `.skp` file safely, assume:

1. ignore blank lines
2. allow `//`-prefixed disabled lines
3. read a time-range line first
4. read the next nonblank line as the label/action/rating line
5. optionally tolerate additional lines attached to an entry for extended features like blur data

## Suggested minimal grammar

A practical approximation of the format is:

```ebnf
file            = { line | entry } ;
entry           = time_line, newline, desc_line, { newline, extra_line } ;
time_line       = ["//"], time, " - ", time ;
desc_line       = ["//"], text ;
extra_line      = text ;
time            = HH, ":", MM, ":", SS, ".", mmm ;
```

## Example parser-friendly JSON representation

A parsed entry might be represented like this:

```json
{
  "start": "00:07:42.100",
  "end": "00:07:49.000",
  "label": "Violence",
  "mode": "skip",
  "rating": 3,
  "disabled": false
}
```

## Important caveat

This reference is based on the project’s public repository materials and app help, and is intended as a practical guide for understanding/editing `.skp` files.

What I could confirm confidently:

- `.skp` is a plain-text skip-list format
- skip entries are centered around a two-line block
- the first line is a time range
- the second line contains label / handling / rating information
- `//` disables entries
- blur-region and screenshot-related data may also be stored

What I could not fully confirm from the materials I reviewed:

- the exact serialized syntax for screenshot payloads
- the exact serialized syntax for every blur-region variant
- whether there are parser edge cases beyond the common two-line structure

## Sources

- VideoSkip GitHub repository: `fruiz500/VideoSkip`
- public README / help / FAQ content in the repository
