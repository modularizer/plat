export type MinMax = {
    min?: number
    max?: number
}

export type Optional = {
    optional?: boolean;
    nullable?: boolean;
}

export type StrOpts = MinMax & Optional & {
    trim?: boolean
    email?: boolean
    url?: boolean
    datetime?: boolean
    date?: boolean
    uuid?: boolean
    cuid?: boolean
    cuid2?: boolean
    ulid?: boolean
    startsWith?: string
    endsWith?: string
    includes?: string
    regex?: RegExp
}

export type NumOpts = MinMax & Optional & {
    coerce?: boolean
    int?: boolean
    positive?: boolean
    nonnegative?: boolean
    finite?: boolean
    multipleOf?: number
}

export type ArrOpts = {
    min?: number
    max?: number
    nonempty?: boolean
}

export type BoolOpts = {
    coerce?: boolean
}

export type Dateish = Date | number | string

export type DateOpts = {
    coerce?: boolean
    min?: Dateish
    max?: Dateish
}
